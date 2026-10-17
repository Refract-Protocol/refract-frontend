import { API_BASE_URL } from "../api/client";

export type NegotiatedTransport = "websocket" | "sse" | "rest";

export type CapabilityDowngradeReason =
  | "ok"
  | "ws_unavailable_in_runtime"
  | "sse_selected_by_backend"
  | "backend_unsupported"
  | "protocol_version_incompatible"
  | "probe_timeout"
  | "malformed_probe_response"
  | "network_error";

export interface RealtimeCapabilityResult {
  supported: boolean;
  negotiatedTransport: NegotiatedTransport;
  availableTransports: Array<"websocket" | "sse">;
  protocolVersion: number | null;
  reason: CapabilityDowngradeReason;
  probedAt: number;
}

export interface ProbeRealtimeCapabilityOptions {
  baseUrl?: string;
  timeoutMs?: number;
  expectedProtocolVersion?: number;
  fetchImpl?: typeof fetch;
  hasWebSocket?: boolean;
  hasEventSource?: boolean;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  forceRefresh?: boolean;
  now?: () => number;
}

export const CAPABILITY_STORAGE_KEY = "refract_realtime_capability_v1";
export const DEFAULT_PROBE_TIMEOUT_MS = 2_500;
export const EXPECTED_PROTOCOL_VERSION = 1;

let memoryCache: RealtimeCapabilityResult | null = null;
let inflightProbe: Promise<RealtimeCapabilityResult> | null = null;

function getDefaultSessionStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Ignore storage access errors in sandboxed iframes or SSR
  }
  return null;
}

function readCachedCapability(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): RealtimeCapabilityResult | null {
  if (memoryCache) return memoryCache;
  if (!storage) return null;

  try {
    const raw = storage.getItem(CAPABILITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RealtimeCapabilityResult;
    if (
      parsed &&
      typeof parsed.supported === "boolean" &&
      (parsed.negotiatedTransport === "websocket" ||
        parsed.negotiatedTransport === "sse" ||
        parsed.negotiatedTransport === "rest")
    ) {
      memoryCache = parsed;
      return parsed;
    }
  } catch {
    // Ignore malformed sessionStorage entries
  }
  return null;
}

function writeCachedCapability(
  result: RealtimeCapabilityResult,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): RealtimeCapabilityResult {
  memoryCache = result;
  if (storage) {
    try {
      storage.setItem(CAPABILITY_STORAGE_KEY, JSON.stringify(result));
    } catch {
      // Ignore quota or private-browsing storage errors
    }
  }
  return result;
}

/**
 * Returns the most recently resolved capability result synchronously (or `null`
 * if the session probe has not yet completed), allowing hooks to start on REST
 * immediately without blocking first paint.
 */
export function getLastCapabilityResult(): RealtimeCapabilityResult | null {
  return memoryCache;
}

/**
 * Clears the memoized capability probe result in memory and `sessionStorage`.
 */
export function clearRealtimeCapabilityCache(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = getDefaultSessionStorage(),
): void {
  memoryCache = null;
  inflightProbe = null;
  try {
    storage?.removeItem(CAPABILITY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Probes `${API_BASE_URL}/realtime/capabilities` once per session to determine
 * whether the backend supports streaming and which transport (`websocket`, `sse`,
 * or `rest`) should be used. Never rejects; timeouts or malformed responses
 * resolve cleanly to `negotiatedTransport: "rest"` with a diagnostic reason.
 */
export async function getRealtimeCapability(
  options: ProbeRealtimeCapabilityOptions = {},
): Promise<RealtimeCapabilityResult> {
  const storage =
    options.storage === undefined ? getDefaultSessionStorage() : options.storage;

  if (!options.forceRefresh) {
    const cached = readCachedCapability(storage);
    if (cached) return cached;
    if (inflightProbe) return inflightProbe;
  }

  const runProbe = async (): Promise<RealtimeCapabilityResult> => {
    const now = options.now ?? (() => Date.now());
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const expectedVersion = options.expectedProtocolVersion ?? EXPECTED_PROTOCOL_VERSION;
    const fetchFn = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
    const hasWs =
      options.hasWebSocket ?? (typeof WebSocket !== "undefined");
    const hasSse =
      options.hasEventSource ?? (typeof EventSource !== "undefined");

    if (!fetchFn) {
      return writeCachedCapability(
        {
          supported: false,
          negotiatedTransport: "rest",
          availableTransports: [],
          protocolVersion: null,
          reason: "network_error",
          probedAt: now(),
        },
        storage,
      );
    }

    const baseUrl = (options.baseUrl ?? API_BASE_URL).replace(/\/$/, "");
    const probeUrl = `${baseUrl}/realtime/capabilities`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchFn(probeUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        return writeCachedCapability(
          {
            supported: false,
            negotiatedTransport: "rest",
            availableTransports: [],
            protocolVersion: null,
            reason: "backend_unsupported",
            probedAt: now(),
          },
          storage,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return writeCachedCapability(
          {
            supported: false,
            negotiatedTransport: "rest",
            availableTransports: [],
            protocolVersion: null,
            reason: "malformed_probe_response",
            probedAt: now(),
          },
          storage,
        );
      }

      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as Record<string, unknown>).supported !== "boolean"
      ) {
        return writeCachedCapability(
          {
            supported: false,
            negotiatedTransport: "rest",
            availableTransports: [],
            protocolVersion: null,
            reason: "malformed_probe_response",
            probedAt: now(),
          },
          storage,
        );
      }

      const record = body as {
        supported: boolean;
        transports?: unknown;
        version?: unknown;
      };

      const protocolVersion =
        typeof record.version === "number" ? record.version : expectedVersion;

      if (!record.supported) {
        return writeCachedCapability(
          {
            supported: false,
            negotiatedTransport: "rest",
            availableTransports: [],
            protocolVersion,
            reason: "backend_unsupported",
            probedAt: now(),
          },
          storage,
        );
      }

      if (protocolVersion !== expectedVersion) {
        return writeCachedCapability(
          {
            supported: false,
            negotiatedTransport: "rest",
            availableTransports: [],
            protocolVersion,
            reason: "protocol_version_incompatible",
            probedAt: now(),
          },
          storage,
        );
      }

      const rawTransports = Array.isArray(record.transports)
        ? record.transports
        : ["websocket", "sse"];
      const availableTransports = rawTransports.filter(
        (t): t is "websocket" | "sse" => t === "websocket" || t === "sse",
      );

      if (availableTransports.includes("websocket") && hasWs) {
        return writeCachedCapability(
          {
            supported: true,
            negotiatedTransport: "websocket",
            availableTransports,
            protocolVersion,
            reason: "ok",
            probedAt: now(),
          },
          storage,
        );
      }

      if (availableTransports.includes("sse") && hasSse) {
        return writeCachedCapability(
          {
            supported: true,
            negotiatedTransport: "sse",
            availableTransports,
            protocolVersion,
            reason: availableTransports.includes("websocket")
              ? "ws_unavailable_in_runtime"
              : "sse_selected_by_backend",
            probedAt: now(),
          },
          storage,
        );
      }

      return writeCachedCapability(
        {
          supported: false,
          negotiatedTransport: "rest",
          availableTransports,
          protocolVersion,
          reason: "backend_unsupported",
          probedAt: now(),
        },
        storage,
      );
    } catch {
      return writeCachedCapability(
        {
          supported: false,
          negotiatedTransport: "rest",
          availableTransports: [],
          protocolVersion: null,
          reason: timedOut ? "probe_timeout" : "network_error",
          probedAt: now(),
        },
        storage,
      );
    } finally {
      clearTimeout(timer);
    }
  };

  inflightProbe = runProbe().finally(() => {
    inflightProbe = null;
  });

  return inflightProbe;
}
