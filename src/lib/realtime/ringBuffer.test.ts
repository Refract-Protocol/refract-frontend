import { describe, it, expect } from "vitest";
import { RingBuffer } from "@/lib/realtime/ringBuffer";

describe("RingBuffer", () => {
  it("stores items up to capacity", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  it("evicts oldest when at capacity", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    const evicted = buf.push(4);
    expect(evicted).toBe(1);
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([2, 3, 4]);
  });

  it("returns the most recent item via latest()", () => {
    const buf = new RingBuffer<string>(5);
    expect(buf.latest()).toBeUndefined();
    buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(buf.latest()).toBe("c");
  });

  it("toArray returns a shallow copy that doesn't affect internal state", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    const copy = buf.toArray();
    copy.push(99);
    expect(buf.length).toBe(2);
    expect(buf.toArray()).toEqual([1, 2]);
  });

  it("clear removes all items", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.isEmpty).toBe(true);
    expect(buf.length).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });

  it("isEmpty is true for a new buffer", () => {
    const buf = new RingBuffer<number>(10);
    expect(buf.isEmpty).toBe(true);
  });

  it("maxCapacity returns the configured capacity", () => {
    const buf = new RingBuffer<number>(42);
    expect(buf.maxCapacity).toBe(42);
  });

  it("handles capacity of 1", () => {
    const buf = new RingBuffer<number>(1);
    buf.push(1);
    expect(buf.toArray()).toEqual([1]);
    const evicted = buf.push(2);
    expect(evicted).toBe(1);
    expect(buf.toArray()).toEqual([2]);
    expect(buf.length).toBe(1);
  });

  it("throws on zero or negative capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-1)).toThrow();
  });

  it("throws on non-finite capacity", () => {
    expect(() => new RingBuffer(Infinity)).toThrow();
    expect(() => new RingBuffer(NaN)).toThrow();
  });

  it("floors fractional capacity to integer", () => {
    const buf = new RingBuffer<number>(3.9);
    expect(buf.maxCapacity).toBe(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.length).toBe(3);
  });

  it("works with object items (shallow copy only)", () => {
    interface Evt { id: number; msg: string }
    const buf = new RingBuffer<Evt>(2);
    buf.push({ id: 1, msg: "a" });
    buf.push({ id: 2, msg: "b" });
    buf.push({ id: 3, msg: "c" });
    const items = buf.toArray();
    expect(items.length).toBe(2);
    expect(items[0]!.id).toBe(2);
    expect(items[1]!.id).toBe(3);
  });
});
