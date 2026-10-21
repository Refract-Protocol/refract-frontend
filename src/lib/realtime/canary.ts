export type CanaryFailure = "transport" | "endpoint" | "auth" | "timeout";

export interface CanaryResult {
  ok: boolean;
  failure?: CanaryFailure;
  connectMs?: number;
  firstEventMs?: number;
  url: string;
  topic: string;
}

/**
 * One connect → subscribe → first-event cycle against the realtime endpoint,
 * speaking the same `{ topic, payload }` wire contract as RealtimeClient.
 * Always resolves (never hangs): times out after `timeoutMs`.
 */
export function probeRealtime(opts: {
  url: string;
  topic: string;
  timeoutMs?: number;
  token?: string;
  WebSocketImpl?: typeof WebSocket;
}): Promise<CanaryResult> {
  const { url, topic, timeoutMs = 10_000, token, WebSocketImpl = WebSocket } = opts;
  const started = Date.now();
  const base = { url, topic };
  return new Promise((resolve) => {
    let connectMs: number | undefined;
    let settled = false;
    let ws: WebSocket | undefined;
    const done = (r: Omit<CanaryResult, "url" | "topic">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      resolve({ ...base, ...r });
    };
    const timer = setTimeout(() => done({ ok: false, failure: "timeout", connectMs }), timeoutMs);
    try {
      ws = new WebSocketImpl(
        token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url
      );
    } catch {
      return done({ ok: false, failure: "endpoint" });
    }
    ws.addEventListener("open", () => {
      connectMs = Date.now() - started;
      ws?.send(JSON.stringify({ action: "subscribe", topic }));
    });
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { topic?: string };
        if (msg.topic === topic) done({ ok: true, connectMs, firstEventMs: Date.now() - started });
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.addEventListener("close", (event) => {
      const code = (event as CloseEvent).code;
      done({
        ok: false,
        failure:
          code === 1008 || code === 4401 || code === 4403
            ? "auth"
            : connectMs === undefined
              ? "endpoint"
              : "transport",
        connectMs,
      });
    });
    ws.addEventListener("error", () =>
      done({ ok: false, failure: connectMs === undefined ? "endpoint" : "transport", connectMs })
    );
  });
}
