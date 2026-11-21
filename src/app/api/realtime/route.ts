import { NextRequest } from "next/server";

/**
 * Realtime bridge/proxy route.
 *
 * Proxies the backend realtime stream through the app's own origin so the
 * browser never talks to `NEXT_PUBLIC_API_URL` directly. Auth is forwarded
 * server-side and the `realtime-oracle` flag (plus future per-topic flags)
 * gates whether a connection is allowed at all.
 *
 * Transport-agnostic: the upstream response body is streamed through without
 * buffering, so it works for both SSE and chunked WS-upgrade-style streams.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_BASE = process.env.REFRACT_BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

// Server-side flag resolution. Kept here so the bridge can gate connections
// without exposing flag state to the client.
function isFlagEnabled(flag: string): boolean {
  const raw = process.env[`FLAG_${flag.toUpperCase().replace(/-/g, "_")}`];
  if (raw === undefined) {
    // Default: realtime-oracle is on unless explicitly disabled.
    return flag === "realtime-oracle";
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

function resolveTopicFlag(topic: string | null): string | null {
  if (!topic) return null;
  return `realtime-${topic}`;
}

function jsonError(status: number, code: string): Response {
  // Never leak upstream error details to the client.
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isFlagEnabled("realtime-oracle")) {
    return jsonError(403, "realtime_disabled");
  }

  const topic = req.nextUrl.searchParams.get("topic");
  const topicFlag = resolveTopicFlag(topic);
  if (topicFlag && !isFlagEnabled(topicFlag)) {
    return jsonError(403, "realtime_topic_disabled");
  }

  // Forward wallet auth from the incoming request headers.
  const wallet = req.headers.get("x-wallet-address") ?? req.headers.get("x-wallet");
  const authHeader = req.headers.get("authorization");
  if (!wallet && !authHeader) {
    return jsonError(401, "realtime_unauthorized");
  }

  if (!UPSTREAM_BASE) {
    return jsonError(503, "realtime_unavailable");
  }

  const upstreamUrl = new URL("/realtime", UPSTREAM_BASE);
  req.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  const upstreamHeaders = new Headers();
  upstreamHeaders.set("accept", req.headers.get("accept") ?? "text/event-stream");
  upstreamHeaders.set("cache-control", "no-cache");
  if (wallet) upstreamHeaders.set("x-wallet-address", wallet);
  if (authHeader) upstreamHeaders.set("authorization", authHeader);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
      // Required for streaming responses in Node fetch.
      // @ts-expect-error -- duplex is valid for streaming bodies in undici.
      duplex: "half",
      signal: req.signal,
    });
  } catch {
    return jsonError(502, "realtime_upstream_error");
  }

  if (!upstream.ok || !upstream.body) {
    return jsonError(502, "realtime_upstream_error");
  }

  // Stream the upstream body straight through without buffering.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
