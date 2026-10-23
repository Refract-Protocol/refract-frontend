import { describe, expect, it } from "vitest";
import { createMerge, type MergeEvent } from "../merge";

interface Row {
  id: string;
  v: number;
  n: string;
}
const m = createMerge<Row>({ getId: (r) => r.id, getVersion: (r) => r.v });
const up = (id: string, v: number, n = `${id}@${v}`): MergeEvent<Row> => ({
  type: "upsert",
  id,
  version: v,
  data: { id, v, n },
});
const rm = (id: string, v: number): MergeEvent<Row> => ({ type: "remove", id, version: v });
const sorted = (rows: Row[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

describe("merge", () => {
  it("inserts entities missing from the snapshot", () => {
    const s = m.reduce(m.init([{ id: "a", v: 1, n: "a" }]), up("b", 2));
    expect(m.view(s).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("ignores duplicates and returns the same state reference", () => {
    const s1 = m.reduce(m.init(), up("a", 5));
    expect(m.reduce(s1, up("a", 5))).toBe(s1);
    expect(m.view(s1)).toHaveLength(1);
  });

  it("drops stale and out-of-order events", () => {
    const s = m.applyAll(m.init([{ id: "a", v: 10, n: "snap" }]), [
      up("a", 3),
      up("a", 12),
      up("a", 11),
    ]);
    expect(m.view(s)[0].n).toBe("a@12");
  });

  it("removes and does not let a stale upsert resurrect", () => {
    let s = m.applyAll(m.init([{ id: "a", v: 1, n: "a" }]), [rm("a", 5), up("a", 4)]);
    expect(m.view(s)).toEqual([]);
    s = m.reduce(s, up("a", 6));
    expect(m.view(s)).toHaveLength(1);
  });

  it("removal of an unknown entity is remembered as a tombstone", () => {
    const s = m.applyAll(m.init(), [rm("x", 5), up("x", 2)]);
    expect(m.view(s)).toEqual([]);
  });

  it("is idempotent and order-independent under shuffled duplicate streams", () => {
    const events = [
      up("a", 1),
      up("a", 4),
      up("b", 2),
      up("c", 3),
      up("b", 7),
      rm("c", 9),
      up("d", 5),
      up("a", 8),
    ];
    const expected = sorted(m.view(m.applyAll(m.init(), events)));
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let run = 0; run < 50; run++) {
      const stream = [...events, ...events.filter(() => rnd() > 0.5)];
      for (let i = stream.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [stream[i], stream[j]] = [stream[j], stream[i]];
      }
      const once = m.applyAll(m.init(), stream);
      expect(sorted(m.view(once))).toEqual(expected);
      expect(m.applyAll(once, stream)).toBe(once);
    }
  });
});
