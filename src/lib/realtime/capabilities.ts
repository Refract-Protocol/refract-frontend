/**
 * Realtime capability detection and transport negotiation.
 *
 * Probes the configured `refract-backend` once per session to determine
 * whether realtime is supported and which transport (WebSocket vs SSE) it
 * offers. The result is memoized in memory and `sessionStorage` so the app
 * degrades cleanly to REST polling on backends that have not yet shipped
 * streaming, without thrashing reconnect attempts.
 *
 * The probe is intentionally fast and never throws: timeouts, network errors,
 * and malformed responses all resolve to an "unsupported" capability so first
 * paint is never blocked and no user-facing error is surfaced.
 */

export type RealtimeTransport = "websocket" | "sse" | "rest";

export interface RealtimeCapability {
  /** Whether the backend supports any realtime transport. */
  supported: boolean;
  /** The negotiated transport; "rest" when realtime is unavailable. */
  transport: RealtimeTransport;
  /** Human-readable reason for the negotiated transport (esp. downgrades). */
  reason: string;
  /** Epoch ms when the probe completed. */
  probedAt: number;
}

const SESSION_KEY = "refract:realtime-capability";
const PROBE_TIMEOUT_MS = 1500;
const PROBE_PATH = "/realtime/capabilities";

let cached: RealtimeCapability | null = null;
let inflight: Promise<RealtimeCapability> | null = null;

function restCapability(reason: string): RealtimeCapability {
  return { supported: false, transport: "rest", reason, probedAt: Date.now() };
}

/**
 * Resolves the backend base URL. Prefers an explicit env override, then the
 * public runtime var, falling back to same-origin (empty prefix).
 */
function resolveBackendBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_REFRACT_BACKEND_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL ??
    "";
  return raw.trim().replace(/\/+$/, "");
}

function readSession(): RealtimeCapability | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RealtimeCapability>;
    if (
      typeof parsed?.supported === "boolean" &&
      (parsed.transport === "websocket" ||
        parsed.transport === "sse" ||
        parsed.transport === "rest") &&
      typeof parsed.reason === "string"
    ) {
      return {
        supported: parsed.supported,
        transport: parsed.transport,
        reason: parsed.reason,
        probedAt: typeof parsed.probedAt === "number" ? parsed.probedAt : Date.now(),
      };
    }
  } catch {
    // Corrupt cache — ignore and re-probe.
  }
  return null;
}

function writeSession(capability: RealtimeCapability): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(capability));
  } catch {
    // Storage may be unavailable (private mode / quota) — memory cache suffices.
  }
}

/**
 * Interprets a probe response body into a capability. Malformed or unknown
 * payloads resolve to REST-only rather than throwing.
 */
function interpretProbe(body: unknown): RealtimeCapability {
  if (!body || typeof body !== "object") {
    return restCapability("malformed probe response");
  }
  const record = body as Record<string, unknown>;
  const transports = Array.isArray(record.transports)
    ? record.transports.filter((t): t is string => typeof t === "string")
    : [];

  if (record.realtime === false || transports.length === 0) {
    return restCapability("backend does not advertise realtime");
  }

  if (transports.includes("websocket")) {
    return {
      supported: true,
      transport: "websocket",
      reason: "backend advertises websocket",
      probedAt: Date.now(),
    };
  }
  if (transports.includes("sse")) {
    return {
      supported: true,
      transport: "sse",
      reason: "backend advertises sse",
      probedAt: Date.now(),
    };
  }
  return restCapability("backend advertises no known transport");
}

async function runProbe(): Promise<RealtimeCapability> {
  const base = resolveBackendBaseUrl();
  const url = `${base}${PROBE_PATH}`;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller?.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return restCapability(`probe returned HTTP ${response.status}`);
    }
    const body = await response.json().catch(() => null);
    return interpretProbe(body);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return restCapability(aborted ? "probe timed out" : "probe failed");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Returns the negotiated realtime capability, probing the backend at most once
 * per session. Concurrent callers share the same in-flight promise. Never
 * rejects — unsupported/unknown outcomes resolve to REST-only.
 */
export function getRealtimeCapability(): Promise<RealtimeCapability> {
  if (cached) return Promise.resolve(cached);

  const fromSession = readSession();
  if (fromSession) {
    cached = fromSession;
    return Promise.resolve(fromSession);
  }

  if (inflight) return inflight;

  inflight = runProbe()
    .then((capability) => {
      cached = capability;
      writeSession(capability);
      return capability;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Clears the memoized capability (memory + sessionStorage). For tests/logout. */
export function resetRealtimeCapability(): void {
  cached = null;
  inflight = null;
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }
}
