import {
  MAX_FRAME_BYTES,
  controlFrameSchema,
  dataEventSchema,
  type RealtimeMessage,
} from "./topics";

export type DecodeFailureKind = "too_large" | "invalid_json" | "invalid_shape";

export interface DecodeFailure {
  kind: DecodeFailureKind;
  message: string;
}

export type DecodeResult =
  { ok: true; message: RealtimeMessage } | { ok: false; error: DecodeFailure };

/**
 * Parses, validates and normalizes a single inbound frame.
 *
 * Pure and synchronous: it runs both on the main thread and inside the
 * decoder Web Worker, so the two paths are guaranteed to produce identical
 * results. Accepts either a raw string (WebSocket/SSE) or an already-parsed
 * object (long-poll responses, which arrive as a JSON batch).
 */
export function decodeFrame(input: unknown): DecodeResult {
  let value: unknown = input;

  if (typeof input === "string") {
    // Length in UTF-16 units is a cheap upper-bound proxy for byte size that
    // avoids allocating an encoded copy of a possibly huge frame.
    if (input.length > MAX_FRAME_BYTES) {
      return fail("too_large", `frame exceeds ${MAX_FRAME_BYTES} bytes`);
    }
    try {
      value = JSON.parse(input);
    } catch {
      return fail("invalid_json", "frame is not valid JSON");
    }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("invalid_shape", "frame must be a JSON object");
  }

  if ("type" in value) {
    const control = controlFrameSchema.safeParse(value);
    if (!control.success) return fail("invalid_shape", summarize(control.error.issues));
    return { ok: true, message: { kind: "control", ...control.data } };
  }

  const event = dataEventSchema.safeParse(value);
  if (!event.success) return fail("invalid_shape", summarize(event.error.issues));
  return { ok: true, message: { kind: "event", ...event.data } };
}

function fail(kind: DecodeFailureKind, message: string): DecodeResult {
  return { ok: false, error: { kind, message } };
}

function summarize(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  const first = issues[0];
  if (!first) return "invalid frame";
  const path = first.path.map(String).join(".");
  return path ? `${path}: ${first.message}` : first.message;
}
