import { describe, it, expect } from "vitest";
import {
  mergeStreamReadings,
  mergeRestReadings,
  parseOraclePayload,
  type StreamReading,
} from "./oracleMerge";

const r = (coverageType: string, extra: Partial<StreamReading> = {}): StreamReading => ({
  coverageType,
  type: "oracle_update",
  value: 1,
  threshold: 0.95,
  severity: "low",
  message: "m",
  ...extra,
});

describe("mergeStreamReadings", () => {
  it("adds new keys and replaces older readings", () => {
    const out = mergeStreamReadings(
      [r("A", { seq: 1 })],
      [r("A", { seq: 2, value: 2 }), r("B", { seq: 1 })]
    );
    expect(out.map((x) => [x.coverageType, x.value])).toEqual([
      ["A", 2],
      ["B", 1],
    ]);
  });

  it("suppresses duplicate and out-of-order readings by seq", () => {
    const cur = [r("A", { seq: 5 })];
    expect(mergeStreamReadings(cur, [r("A", { seq: 5, value: 9 })])).toBe(cur);
    expect(mergeStreamReadings(cur, [r("A", { seq: 4, value: 9 })])).toBe(cur);
  });

  it("falls back to ts when seq is absent", () => {
    const cur = [r("A", { ts: 100 })];
    expect(mergeStreamReadings(cur, [r("A", { ts: 99, value: 9 })])).toBe(cur);
    expect(mergeStreamReadings(cur, [r("A", { ts: 101, value: 9 })])[0].value).toBe(9);
  });

  it("returns the same reference when an unordered frame is identical", () => {
    const cur = [r("A")];
    expect(mergeStreamReadings(cur, [r("A")])).toBe(cur);
  });
});

describe("mergeRestReadings", () => {
  it("keeps the seq/ts high-water mark across a REST snapshot", () => {
    const merged = mergeRestReadings([r("A", { seq: 7, ts: 70 })], [r("A", { value: 3 })]);
    expect(merged[0]).toMatchObject({ value: 3, seq: 7, ts: 70 });
    expect(mergeStreamReadings(merged, [r("A", { seq: 6, value: 9 })])).toBe(merged);
  });
});

describe("parseOraclePayload", () => {
  it("accepts a single reading or an array and drops malformed entries", () => {
    expect(parseOraclePayload(r("A"))).toHaveLength(1);
    expect(parseOraclePayload([r("A"), null, { nope: 1 }, r("B")])).toHaveLength(2);
    expect(parseOraclePayload("x")).toEqual([]);
  });
});
