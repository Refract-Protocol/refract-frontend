import { describe, expect, it } from "vitest";
import {
  decodeRealtimeFrame,
  MAX_REALTIME_FRAME_BYTES,
  MAX_REALTIME_NESTING_DEPTH,
  RealtimeDecodeError,
} from "./client";

describe("bounded realtime wire decoder", () => {
  it("accepts valid payloads with unknown fields and preserves hostile keys as inert data", () => {
    const decoded = decodeRealtimeFrame(
      '{"topic":"oracle_update","payload":{"__proto__":{"polluted":true},"constructor":"extra"},"extra":1}'
    );
    expect(decoded.topic).toBe("oracle_update");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(decoded.payload)).toBe(Object.prototype);
    expect(() => decodeRealtimeFrame('{"topic":"../wrong","payload":{}}')).toThrow(
      RealtimeDecodeError
    );
  });

  it("rejects oversized, deeply nested, truncated and malformed binary frames with typed errors", () => {
    const samples: unknown[] = [
      "x".repeat(MAX_REALTIME_FRAME_BYTES + 1),
      `${"[".repeat(MAX_REALTIME_NESTING_DEPTH + 1)}0${"]".repeat(MAX_REALTIME_NESTING_DEPTH + 1)}`,
      '{"topic":',
      new Uint8Array([0xff, 0xfe]).buffer,
    ];
    for (const sample of samples)
      expect(() => decodeRealtimeFrame(sample)).toThrow(RealtimeDecodeError);
  });

  it("survives a reproducible seeded hostile corpus without untyped exceptions", () => {
    let seed = 0x279278;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const corpus = [
      "null",
      "[]",
      "{}",
      '{"topic":"__proto__","payload":0}',
      '{"topic":"oracle_update","payload":null,"sequence":1e999}',
      '{"topic":"oracle_update","payload":{},"sequence":2}',
      '{"topic":"oracle_update","payload":{},"sequence":2}',
    ];
    for (let i = 0; i < 500; i++) {
      const raw =
        i < corpus.length
          ? corpus[i]
          : JSON.stringify({
              topic: `t${next() % 9}`,
              payload: { value: next(), nested: [next() % 4, next() % 8] },
              sequence: next() % 17,
            });
      try {
        expect(decodeRealtimeFrame(raw)).toHaveProperty("topic");
      } catch (error) {
        expect(error).toBeInstanceOf(RealtimeDecodeError);
      }
    }
  });

  it("enforces the documented frame-size cap", () => {
    expect(MAX_REALTIME_FRAME_BYTES).toBe(256 * 1024);
  });
});
