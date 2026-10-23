/**
 * Shared inbound-frame decoding for every realtime transport (issue #249).
 *
 * WebSocket, SSE and long-poll paths all hand raw frames to `decodeFrame`, so
 * they share one size ceiling and one definition of a malformed message.
 */

/**
 * Maximum accepted inbound message size, in UTF-8 bytes, checked before
 * `JSON.parse` runs.
 *
 * Sizing: steady-state pushes (oracle readings, pool stats, policy events)
 * are well under 4 KiB. The largest legitimate frame is an initial topic
 * snapshot, which the realtime contract caps at 200 policy/claim rows
 * (~150 KiB as JSON). 256 KiB leaves headroom over that snapshot while still
 * keeping a hostile frame from stalling the main thread in `JSON.parse`.
 * Raise it together with the snapshot cap in docs/realtime.md, never alone.
 */
export const MAX_MESSAGE_BYTES = 256 * 1024;

/** Envelope every realtime message uses. */
export interface RealtimeEnvelope {
  topic: string;
  payload: unknown;
  /** Server timestamp (ms since epoch). Normalize with `normalizeServerTs` before use. */
  ts?: number;
}

export type RealtimeProtocolErrorCode = "oversize" | "malformed" | "unsupported_frame";

/** A frame the client refused to process. See docs/realtime.md "Error path". */
export class RealtimeProtocolError extends Error {
  constructor(
    public readonly code: RealtimeProtocolErrorCode,
    message: string,
    /** Size of the rejected frame in bytes, when known. */
    public readonly bytes?: number
  ) {
    super(message);
    this.name = "RealtimeProtocolError";
  }
}

export type DecodeResult =
  | { ok: true; envelope: RealtimeEnvelope; bytes: number }
  | { ok: false; error: RealtimeProtocolError };

/** UTF-8 byte length of a string without allocating an encoded copy. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // Surrogate pair: one 4-byte code point.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function oversize(bytes: number, maxBytes: number): DecodeResult {
  return {
    ok: false,
    error: new RealtimeProtocolError(
      "oversize",
      `Inbound frame of ${bytes} bytes exceeds the ${maxBytes}-byte limit`,
      bytes
    ),
  };
}

/**
 * Validates and parses one inbound frame.
 *
 * Accepts text frames and `ArrayBuffer` binary frames (UTF-8 JSON). Frames
 * over `maxBytes` are rejected *before* parsing. Never throws.
 */
export function decodeFrame(data: unknown, maxBytes: number = MAX_MESSAGE_BYTES): DecodeResult {
  let text: string;
  let bytes: number;

  if (typeof data === "string") {
    // Every UTF-16 code unit is at least one UTF-8 byte, so a string longer
    // than the limit is oversize without scanning it.
    if (data.length > maxBytes) return oversize(data.length, maxBytes);
    bytes = utf8ByteLength(data);
    if (bytes > maxBytes) return oversize(bytes, maxBytes);
    text = data;
  } else if (data instanceof ArrayBuffer) {
    bytes = data.byteLength;
    if (bytes > maxBytes) return oversize(bytes, maxBytes);
    text = new TextDecoder().decode(data);
  } else {
    return {
      ok: false,
      error: new RealtimeProtocolError("unsupported_frame", "Unsupported frame type"),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: new RealtimeProtocolError("malformed", "Frame is not valid JSON", bytes),
    };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { topic?: unknown }).topic !== "string"
  ) {
    return {
      ok: false,
      error: new RealtimeProtocolError("malformed", "Frame is missing a string `topic`", bytes),
    };
  }

  const { topic, payload, ts } = parsed as { topic: string; payload?: unknown; ts?: unknown };
  return {
    ok: true,
    bytes,
    envelope: { topic, payload, ...(typeof ts === "number" && Number.isFinite(ts) ? { ts } : {}) },
  };
}
