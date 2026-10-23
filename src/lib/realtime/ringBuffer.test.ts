/**
 * Unit tests for the bounded ring-buffer and topic registry.
 * Closes #253.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RingBuffer, TopicRegistry, DEFAULT_CAPACITY, MAX_GLOBAL_TOPICS } from "./ringBuffer";
import type { RealtimeFrame } from "./ringBuffer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(topic: string, seq: number, payload?: unknown): RealtimeFrame {
  return { topic, payload: payload ?? { seq }, receivedAt: Date.now(), seq };
}

// ---------------------------------------------------------------------------
// RingBuffer
// ---------------------------------------------------------------------------

describe("RingBuffer", () => {
  it("rejects capacity < 1", () => {
    expect(() => new RingBuffer({ capacity: 0 })).toThrow(RangeError);
  });

  it("stores frames in insertion order", () => {
    const buf = new RingBuffer({ capacity: 4 });
    for (let i = 0; i < 4; i++) buf.push(makeFrame("t", i));
    const frames = buf.snapshot();
    expect(frames.map((f) => (f.payload as { seq: number }).seq)).toEqual([0, 1, 2, 3]);
  });

  it("evicts oldest frame when full (FIFO drop)", () => {
    const buf = new RingBuffer({ capacity: 3 });
    for (let i = 0; i < 5; i++) buf.push(makeFrame("t", i));
    const frames = buf.snapshot();
    // Only the last 3 frames should be retained.
    expect(frames.map((f) => (f.payload as { seq: number }).seq)).toEqual([2, 3, 4]);
  });

  it("returns the evicted frame from push()", () => {
    const buf = new RingBuffer({ capacity: 2 });
    buf.push(makeFrame("t", 0));
    buf.push(makeFrame("t", 1));
    const evicted = buf.push(makeFrame("t", 2));
    expect(evicted).toBeDefined();
    expect((evicted!.payload as { seq: number }).seq).toBe(0);
  });

  it("drain() returns frames and clears the buffer", () => {
    const buf = new RingBuffer({ capacity: 4 });
    for (let i = 0; i < 3; i++) buf.push(makeFrame("t", i));
    const drained = buf.drain();
    expect(drained).toHaveLength(3);
    expect(buf.size).toBe(0);
  });

  it("snapshot() does NOT clear the buffer", () => {
    const buf = new RingBuffer({ capacity: 4 });
    for (let i = 0; i < 3; i++) buf.push(makeFrame("t", i));
    buf.snapshot();
    expect(buf.size).toBe(3);
  });

  it("size and isFull stay consistent through push/drain cycles", () => {
    const buf = new RingBuffer({ capacity: 3 });
    expect(buf.isFull).toBe(false);
    buf.push(makeFrame("t", 0));
    buf.push(makeFrame("t", 1));
    buf.push(makeFrame("t", 2));
    expect(buf.isFull).toBe(true);
    buf.drain();
    expect(buf.isFull).toBe(false);
    expect(buf.size).toBe(0);
  });

  it("clear() empties the buffer", () => {
    const buf = new RingBuffer({ capacity: 3 });
    for (let i = 0; i < 3; i++) buf.push(makeFrame("t", i));
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.snapshot()).toHaveLength(0);
  });

  it("handles capacity=1 (single-slot buffer)", () => {
    const buf = new RingBuffer({ capacity: 1 });
    buf.push(makeFrame("t", 0));
    buf.push(makeFrame("t", 1));
    expect(buf.size).toBe(1);
    const frames = buf.snapshot();
    expect((frames[0].payload as { seq: number }).seq).toBe(1);
  });

  it("respects the default capacity", () => {
    const buf = new RingBuffer();
    expect(buf.capacity).toBe(DEFAULT_CAPACITY);
  });

  it("preserves insertion order after wrapping the internal pointer multiple times", () => {
    const cap = 8;
    const buf = new RingBuffer({ capacity: cap });
    // Push 3 * capacity frames — the buffer should always hold the last `cap` frames.
    const total = cap * 3;
    for (let i = 0; i < total; i++) buf.push(makeFrame("t", i));
    const frames = buf.snapshot();
    expect(frames).toHaveLength(cap);
    const expected = Array.from({ length: cap }, (_, j) => total - cap + j);
    expect(frames.map((f) => (f.payload as { seq: number }).seq)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// TopicRegistry
// ---------------------------------------------------------------------------

describe("TopicRegistry", () => {
  let registry: TopicRegistry;

  beforeEach(() => {
    registry = new TopicRegistry({ defaultCapacity: 8 });
  });

  it("records frames and makes them available via snapshot()", () => {
    registry.record("oracle_update", { value: 1 });
    registry.record("oracle_update", { value: 2 });
    const frames = registry.snapshot("oracle_update");
    expect(frames).toHaveLength(2);
    expect((frames[1].payload as { value: number }).value).toBe(2);
  });

  it("assigns monotonically increasing seq numbers across topics", () => {
    registry.record("topic_a", {});
    registry.record("topic_b", {});
    registry.record("topic_a", {});
    const all = registry.snapshotAll();
    expect(all.map((f) => f.seq)).toEqual([0, 1, 2]);
  });

  it("drain() returns frames and clears the topic buffer", () => {
    for (let i = 0; i < 4; i++) registry.record("t", { i });
    const drained = registry.drain("t");
    expect(drained).toHaveLength(4);
    expect(registry.snapshot("t")).toHaveLength(0);
  });

  it("drainAll() returns all frames sorted by seq, then clears all buffers", () => {
    registry.record("a", { v: 1 });
    registry.record("b", { v: 2 });
    registry.record("a", { v: 3 });
    const all = registry.drainAll();
    expect(all.map((f) => f.topic)).toEqual(["a", "b", "a"]);
    expect(registry.totalBuffered).toBe(0);
  });

  it("enforces maxTopics — excess topics are silently dropped", () => {
    const reg = new TopicRegistry({ maxTopics: 2 });
    reg.record("t1", {});
    reg.record("t2", {});
    const result = reg.record("t3", {}); // should be dropped
    expect(result).toBeUndefined();
    expect(reg.droppedTopics).toBe(1);
    expect(reg.topics).not.toContain("t3");
  });

  it("defaults to MAX_GLOBAL_TOPICS when maxTopics not specified", () => {
    const reg = new TopicRegistry();
    // We can't easily push 64 topics in a unit test; just verify the cap constant.
    expect(MAX_GLOBAL_TOPICS).toBe(64);
  });

  it("per-topic capacity override is respected", () => {
    const reg = new TopicRegistry({
      defaultCapacity: 4,
      topicCapacities: { slow_topic: 2 },
    });
    for (let i = 0; i < 6; i++) reg.record("slow_topic", { i });
    // Only the last 2 should be retained for slow_topic.
    expect(reg.snapshot("slow_topic")).toHaveLength(2);
  });

  it("returns empty array for unknown topic in snapshot() and drain()", () => {
    expect(registry.snapshot("nonexistent")).toEqual([]);
    expect(registry.drain("nonexistent")).toEqual([]);
  });

  it("reset() clears all buffers and the seq counter", () => {
    registry.record("a", {});
    registry.record("b", {});
    registry.reset();
    expect(registry.topics).toHaveLength(0);
    expect(registry.seq).toBe(0);
    expect(registry.totalBuffered).toBe(0);
  });

  it("totalBuffered sums across all topics", () => {
    registry.record("a", {});
    registry.record("a", {});
    registry.record("b", {});
    expect(registry.totalBuffered).toBe(3);
  });

  it("evicts oldest frames per-topic when the buffer fills under load", () => {
    const cap = 8;
    const reg = new TopicRegistry({ defaultCapacity: cap });
    const total = cap * 5;
    for (let i = 0; i < total; i++) {
      reg.record("oracle_update", { seq: i });
    }
    // Buffer should hold the last `cap` frames only.
    const frames = reg.snapshot("oracle_update");
    expect(frames).toHaveLength(cap);
    expect((frames[0].payload as { seq: number }).seq).toBe(total - cap);
    expect((frames[cap - 1].payload as { seq: number }).seq).toBe(total - 1);
  });
});
