import { describe, it, expect } from "vitest";
import {
  applyFrame,
  applyPatch,
  isRejection,
  isTopicFrame,
  type PatchFrame,
  type TopicFrame,
} from "../patch";

const snap = (revision: number, data: Record<string, unknown>): TopicFrame => ({
  kind: "snapshot",
  revision,
  data,
});
const patch = (
  base_revision: number,
  revision: number,
  set: Record<string, unknown>
): PatchFrame => ({
  kind: "patch",
  base_revision,
  revision,
  set,
});

describe("applyPatch", () => {
  it("sequence of patches equals the corresponding snapshots", () => {
    const snaps = [
      snap(1, { a: 1, nested: { x: 1, y: 2 } }),
      snap(2, { a: 2, nested: { x: 1, y: 2 } }),
      snap(3, { a: 2, nested: { x: 1, y: 5 }, b: 9 }),
    ];
    const patches = [patch(1, 2, { a: 2 }), patch(2, 3, { nested: { y: 5 }, b: 9 })];
    let state = applyFrame(null, snaps[0]);
    for (const p of patches) {
      if (isRejection(state)) throw new Error("unexpected rejection");
      state = applyFrame(state, p);
    }
    expect(state).toEqual({ revision: 3, data: (snaps[2] as { data: unknown }).data });
  });

  it("removes keys set to null", () => {
    const s = { revision: 1, data: { a: 1, b: 2 } };
    expect(applyPatch(s, patch(1, 2, { b: null }))).toEqual({ revision: 2, data: { a: 1 } });
  });

  it("requests resync on revision gap or missing base", () => {
    const s = { revision: 1, data: { a: 1 } };
    expect(applyPatch(s, patch(3, 4, { a: 2 }))).toMatchObject({
      reason: "revision_gap",
      resync: true,
    });
    expect(applyPatch(null, patch(1, 2, {}))).toMatchObject({ reason: "no_base", resync: true });
  });

  it("ignores duplicate and out-of-order patches without resync", () => {
    const s = { revision: 5, data: { a: 1 } };
    expect(applyPatch(s, patch(4, 5, { a: 2 }))).toMatchObject({ reason: "stale", resync: false });
    expect(applyPatch(s, patch(2, 3, { a: 2 }))).toMatchObject({ reason: "stale", resync: false });
  });

  it("rejects malformed patches and does not mutate state", () => {
    const s = { revision: 1, data: { a: { b: 1 } } };
    const before = JSON.stringify(s);
    expect(
      applyPatch(s, { kind: "patch", base_revision: 1, revision: 1, set: {} } as PatchFrame)
    ).toMatchObject({ reason: "malformed" });
    applyPatch(s, patch(1, 2, { a: { b: 2 } }));
    expect(JSON.stringify(s)).toBe(before);
  });

  it("discards snapshots older than current but accepts newer at any time", () => {
    const s = { revision: 5, data: { a: 1 } };
    expect(applyFrame(s, snap(4, { a: 0 }))).toMatchObject({ reason: "stale" });
    expect(applyFrame(s, snap(9, { a: 9 }))).toEqual({ revision: 9, data: { a: 9 } });
  });

  it("validates frames", () => {
    expect(isTopicFrame({ kind: "x" })).toBe(false);
    expect(isTopicFrame(snap(1, {}))).toBe(true);
  });
});
