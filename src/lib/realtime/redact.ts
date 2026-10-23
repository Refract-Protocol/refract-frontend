const SENSITIVE_KEY =
  /token|authorization|cookie|wallet|address|holder|signature|signed|secret|credential|session/i;
const MAX_STRING = 240;
const MAX_ITEMS = 30;

/** Redacts secret-bearing fields and bounds unknown values before diagnostics leave the transport. */
export function sanitizeRealtimeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (value instanceof Error)
    return { name: value.name.slice(0, 80), message: "[error message redacted]" };
  if (typeof value === "string")
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (Array.isArray(value))
    return value.slice(0, MAX_ITEMS).map((item) => sanitizeRealtimeValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ITEMS)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeRealtimeValue(item, depth + 1),
        ])
    );
  }
  return value;
}

export function summarizeRealtimeValue(value: unknown): { bytes: number } {
  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    /* Non-serializable payload. */
  }
  return { bytes };
}

type LogLevel = "debug" | "warn";
function emit(level: LogLevel, message: string, context?: unknown): void {
  let verbose = false;
  try {
    verbose =
      process.env.NODE_ENV !== "production" &&
      sessionStorage.getItem("refract:realtime-debug") === "1";
  } catch {
    /* Debug logging stays off when storage is unavailable. */
  }
  if (level === "debug" && !verbose) return;
  const safe = sanitizeRealtimeValue(context);
  const method = level === "debug" ? console.debug : console.warn;
  method(`[realtime] ${message}`, safe);
}

/** All realtime diagnostics pass through this boundary; debug mode is a temporary localStorage switch. */
export const realtimeLogger = {
  debug: (message: string, context?: unknown) => emit("debug", message, context),
  warn: (message: string, context?: unknown) => emit("warn", message, context),
};
