export type RealtimeTransport = "ws" | "sse" | "mock";
export type RealtimeMode = RealtimeTransport | "off";
export interface RealtimeOverride {
  mode: RealtimeMode;
  endpoint?: string;
}
export interface RealtimeConfig {
  enabled: boolean;
  endpoint: string;
  transport: RealtimeMode | "rest";
}
const STORAGE_KEY = "refract_qa_realtime_override_v1";
const ALLOWED_HOSTS = (process.env.NEXT_PUBLIC_REALTIME_OVERRIDE_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export function isRealtimeOverrideAllowed(hostname?: string): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(hostname && ALLOWED_HOSTS.includes(hostname));
}

export function parseRealtimeOverride(params: URLSearchParams): RealtimeOverride | null {
  const mode = params.get("realtime");
  if (mode !== "off" && mode !== "ws" && mode !== "sse" && mode !== "mock") return null;
  const endpoint = params.get("realtimeEndpoint") ?? undefined;
  return { mode, ...(endpoint ? { endpoint } : {}) };
}

export function readRealtimeOverride(hostname?: string): RealtimeOverride | null {
  if (
    typeof window === "undefined" ||
    !isRealtimeOverrideAllowed(hostname ?? window.location.hostname)
  )
    return null;
  const queryOverride = parseRealtimeOverride(new URLSearchParams(window.location.search));
  if (queryOverride) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queryOverride));
    } catch {
      /* Storage can be disabled. */
    }
    return queryOverride;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as RealtimeOverride;
    if (
      ["off", "ws", "sse", "mock"].includes(value.mode) &&
      (!value.endpoint || typeof value.endpoint === "string")
    )
      return value;
  } catch {
    /* Ignore invalid or unavailable storage. */
  }
  return null;
}

export function resetRealtimeOverride(): void {
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Ignore storage failures. */
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("realtime");
    url.searchParams.delete("realtimeEndpoint");
    window.history.replaceState({}, "", url.toString());
  }
}

/** Precedence: remote kill switch, environment config, development override, safe defaults. */
export function resolveRealtimeConfig(
  environment: RealtimeConfig,
  override: RealtimeOverride | null,
  hostname?: string,
  remoteKillSwitch = false
): RealtimeConfig {
  if (remoteKillSwitch) return { ...environment, enabled: false, transport: "off" };
  if (override && isRealtimeOverrideAllowed(hostname)) {
    const endpoint = override.endpoint ?? environment.endpoint;
    let normalizedEndpoint = endpoint;
    try {
      const parsed = new URL(endpoint, "http://localhost");
      if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol))
        throw new Error("Unsupported realtime endpoint protocol");
      if (override.mode === "ws" || override.mode === "mock")
        parsed.protocol =
          parsed.protocol === "https:" || parsed.protocol === "wss:" ? "wss:" : "ws:";
      if (override.mode === "sse")
        parsed.protocol =
          parsed.protocol === "https:" || parsed.protocol === "wss:" ? "https:" : "http:";
      normalizedEndpoint = parsed.toString();
    } catch {
      normalizedEndpoint = environment.endpoint;
    }
    return {
      enabled: override.mode !== "off",
      transport: override.mode,
      endpoint: normalizedEndpoint,
    };
  }
  return environment;
}
