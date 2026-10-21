/**
 * A bounded, fixed-capacity ring buffer for realtime event storage.
 *
 * Each realtime topic gets its own ring buffer (see `RealtimeClient`) so
 * that a high-frequency or misbehaving stream cannot grow client memory
 * without limit during a long browser session. Once the buffer is full
 * the oldest entry is silently evicted — callers always get the most
 * recent `capacity` events.
 *
 * The cap is a hard invariant: `length` never exceeds `capacity`, and the
 * array returned by `toArray()` is always a fresh shallow copy so internal
 * storage can't be mutated by the caller.
 *
 * @invariant length <= capacity
 */
export class RingBuffer<T> {
  private readonly items: T[] = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity <= 0 || !Number.isFinite(capacity)) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = Math.floor(capacity);
  }

  /** Maximum number of items the buffer retains. */
  get maxCapacity(): number {
    return this.capacity;
  }

  /** Current number of stored items (never exceeds `maxCapacity`). */
  get length(): number {
    return this.items.length;
  }

  /** True when no items are stored. */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Appends an item, evicting the oldest when at capacity.
   * Returns the evicted item, or `undefined` when nothing was evicted.
   */
  push(item: T): T | undefined {
    let evicted: T | undefined;
    if (this.items.length >= this.capacity) {
      evicted = this.items.shift();
    }
    this.items.push(item);
    return evicted;
  }

  /** Returns the most recent item, or `undefined` when empty. */
  latest(): T | undefined {
    return this.items[this.items.length - 1];
  }

  /** Returns a fresh shallow copy of stored items, oldest-first. */
  toArray(): T[] {
    return [...this.items];
  }

  /** Removes all stored items. */
  clear(): void {
    this.items.length = 0;
  }
}
