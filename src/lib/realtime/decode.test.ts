import { describe, expect, it } from "vitest";
import { decodeFrame } from "./decode";
import { supportedVersions } from "./contract";
import { RealtimeParseError, RealtimeValidationError, UnsupportedVersionError } from "./errors";

const READING = {
  coverageType: "StablecoinDepeg",
  type: "oracle_update",
  value: 0.9991,
  threshold: 0.95,
  severity: "low",
  message: "USDC within peg",
} as const;

const CLAIM = {
  policyId: "p-1",
  holder: "GABC",
  coverageType: 0,
  triggered: true,
  payout: "50000000000",
  reason: "Depeg",
  processedAt: 1_700_000_000_000,
};

/** One fixture per supported (topic, version). */
const FIXTURES = {
  "oracle_update v1": { topic: "oracle_update", v: 1, payload: READING },
  "oracle_update v2": {
    topic: "oracle_update",
    v: 2,
    payload: { reading: { ...READING, type: undefined }, observedAt: 1_700_000_000_000 },
  },
  "claim_settled v1": { topic: "claim_settled", v: 1, payload: CLAIM },
  "holder_claim v1": { topic: "holder_claim", v: 1, payload: CLAIM },
} as const;

describe("decodeFrame — supported versions", () => {
  it.each(Object.entries(FIXTURES))("decodes %s", (_name, frame) => {
    const decoded = decodeFrame(JSON.stringify(frame));
    expect(decoded).toMatchObject({ kind: "data", topic: frame.topic, version: frame.v });
  });

  it("normalises oracle v1 and v2 to the same in-app shape", () => {
    const v1 = decodeFrame(JSON.stringify(FIXTURES["oracle_update v1"]));
    const v2 = decodeFrame(JSON.stringify(FIXTURES["oracle_update v2"]));
    expect(v1.kind === "data" && v1.payload).toEqual(READING);
    expect(v2.kind === "data" && v2.payload).toEqual(READING);
  });

  it("advertises versions newest first", () => {
    expect(supportedVersions("oracle_update")).toEqual([2, 1]);
    expect(supportedVersions("claim_settled")).toEqual([1]);
  });
});

describe("decodeFrame — missing and future versions", () => {
  it("treats a frame without `v` as the legacy version, not an error", () => {
    const decoded = decodeFrame(JSON.stringify({ topic: "oracle_update", payload: READING }));
    expect(decoded).toMatchObject({ kind: "data", version: 1, payload: READING });
  });

  it("rejects a future version as a non-retryable UnsupportedVersionError", () => {
    const err = (() => {
      try {
        decodeFrame(JSON.stringify({ topic: "oracle_update", v: 99, payload: {} }));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(UnsupportedVersionError);
    expect(err).toMatchObject({
      kind: "unsupported_version",
      retryable: false,
      topic: "oracle_update",
      version: 99,
    });
  });

  it.each([0, -1, 1.5, "2"])("rejects a malformed version field (%s)", (v) => {
    expect(() =>
      decodeFrame(JSON.stringify({ topic: "oracle_update", v, payload: READING }))
    ).toThrow(RealtimeValidationError);
  });
});

describe("decodeFrame — bad frames", () => {
  it("throws a parse error for non-JSON", () => {
    expect(() => decodeFrame("{nope")).toThrow(RealtimeParseError);
  });

  it("throws a parse error for a frame with no topic or payload", () => {
    expect(() => decodeFrame(JSON.stringify({ payload: 1 }))).toThrow(RealtimeParseError);
    expect(() => decodeFrame(JSON.stringify({ topic: "oracle_update" }))).toThrow(
      RealtimeParseError
    );
  });

  it("throws a validation error for a payload that fails the schema", () => {
    expect(() =>
      decodeFrame(
        JSON.stringify({ topic: "oracle_update", v: 1, payload: { ...READING, value: "high" } })
      )
    ).toThrow(RealtimeValidationError);
  });

  it("throws a validation error for an unknown topic", () => {
    expect(() => decodeFrame(JSON.stringify({ topic: "nope", v: 1, payload: {} }))).toThrow(
      RealtimeValidationError
    );
  });
});

describe("decodeFrame — control frames", () => {
  it("decodes the server's unsupported_version response", () => {
    expect(
      decodeFrame(
        JSON.stringify({
          type: "error",
          code: "unsupported_version",
          topic: "oracle_update",
          supported: [3],
        })
      )
    ).toEqual({ kind: "unsupported_version", topic: "oracle_update", supported: [3] });
  });

  it("decodes a subscribe acknowledgement", () => {
    expect(
      decodeFrame(JSON.stringify({ type: "subscribed", topic: "claim_settled", v: 1 }))
    ).toEqual({
      kind: "subscribed",
      topic: "claim_settled",
      version: 1,
    });
  });
});
