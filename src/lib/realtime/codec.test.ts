import { describe, expect, it } from "vitest";
import { decodeFrame, MAX_MESSAGE_BYTES, utf8ByteLength } from "./codec";

/** A JSON envelope whose serialized form is exactly `bytes` long (ASCII). */
function frameOfSize(bytes: number): string {
  const shell = JSON.stringify({ topic: "t", payload: "" });
  return JSON.stringify({ topic: "t", payload: "x".repeat(bytes - shell.length) });
}

describe("decodeFrame", () => {
  it("accepts a frame exactly at the limit", () => {
    const frame = frameOfSize(MAX_MESSAGE_BYTES);
    expect(frame.length).toBe(MAX_MESSAGE_BYTES);
    const result = decodeFrame(frame);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes).toBe(MAX_MESSAGE_BYTES);
  });

  it("rejects a frame one byte over the limit, before parsing", () => {
    const result = decodeFrame(frameOfSize(MAX_MESSAGE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("oversize");
      expect(result.error.bytes).toBe(MAX_MESSAGE_BYTES + 1);
    }
  });

  it("measures UTF-8 bytes, not string length", () => {
    // 100 three-byte characters: 100 code units, 300 bytes.
    const frame = JSON.stringify({ topic: "t", payload: "€".repeat(100) });
    expect(decodeFrame(frame, frame.length + 10).ok).toBe(false);
    expect(decodeFrame(frame, utf8ByteLength(frame)).ok).toBe(true);
  });

  it("counts surrogate pairs as 4 bytes", () => {
    expect(utf8ByteLength("😀")).toBe(4);
    expect(utf8ByteLength("aé€😀")).toBe(1 + 2 + 3 + 4);
  });

  it("applies the same limit to binary frames", () => {
    const bytes = new TextEncoder().encode(frameOfSize(1_000));
    expect(decodeFrame(bytes.buffer, 999).ok).toBe(false);
    const ok = decodeFrame(bytes.buffer, 1_000);
    expect(ok.ok && ok.envelope.topic).toBe("t");
  });

  it("rejects malformed JSON and envelopes without a topic", () => {
    expect(decodeFrame("{nope")).toMatchObject({ ok: false, error: { code: "malformed" } });
    expect(decodeFrame('{"payload":1}')).toMatchObject({ ok: false, error: { code: "malformed" } });
    expect(decodeFrame("null")).toMatchObject({ ok: false, error: { code: "malformed" } });
  });

  it("rejects unsupported frame types", () => {
    expect(decodeFrame(42)).toMatchObject({ ok: false, error: { code: "unsupported_frame" } });
  });

  it("keeps a numeric ts and drops a bad one", () => {
    const a = decodeFrame('{"topic":"t","payload":1,"ts":123}');
    expect(a.ok && a.envelope).toEqual({ topic: "t", payload: 1, ts: 123 });
    const b = decodeFrame('{"topic":"t","payload":1,"ts":"soon"}');
    expect(b.ok && b.envelope).toEqual({ topic: "t", payload: 1 });
  });
});
