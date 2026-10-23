import { parseInboundFrame } from "./schemas";

/** Diagnostic counters for inbound frame validation. */
export const validationDiagnostics = {
  dropped: 0,
  versionMismatch: 0,
};

const LOG_INTERVAL_MS = 5000;
let lastWarningAt = 0;

function warnRateLimited(message: string) {
  if (process.env.NODE_ENV === "production") return;
  const now = Date.now();
  if (now - lastWarningAt < LOG_INTERVAL_MS) return;
  lastWarningAt = now;
  // eslint-disable-next-line no-console
  console.warn(`[realtime] ${message}`);
}

export type MessageHandler = (frame: unknown) => void;

export interface MessageDispatcher {
  onMessage: (raw: unknown) => void;
  isIncompatible: () => boolean;
}

/**
 * Create a dispatcher that validates every inbound frame before handing it to
 * the downstream handler. Invalid frames are dropped and counted; a protocol
 * version mismatch marks the transport incompatible so it can fall back to REST.
 */
export function createMessageDispatcher(
  handler: MessageHandler,
): MessageDispatcher {
  let incompatible = false;

  return {
    onMessage(raw: unknown) {
      if (incompatible) return;

      const result = parseInboundFrame(raw);
      if (!result.ok) {
        validationDiagnostics.dropped += 1;
        if (result.reason === "version") {
          validationDiagnostics.versionMismatch += 1;
          incompatible = true;
          warnRateLimited(
            "incompatible protocol version; falling back to REST",
          );
        } else {
          warnRateLimited("dropped malformed inbound frame");
        }
        return;
      }

      handler(result.frame);
    },
    isIncompatible() {
      return incompatible;
    },
  };
}
