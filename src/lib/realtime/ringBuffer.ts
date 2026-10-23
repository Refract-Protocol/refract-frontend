/**
 * Bounded, per-topic in-memory ring buffer for realtime frames and items.
 * Closes #253.
 */

export interface RealtimeFrame<T = unknown> {
  topic: string;
  payload: T;
  receivedAt: number;
  seq: number;
}

export interface RingBufferOptions {
  capacity?: number;
}

export const DEFAULT_CAPACITY = 256;
export const MAX_GLOBAL_TOPICS = 64;

export class RingBuffer<T = RealtimeFrame> {
  private readonly buf: (T | undefined)[];
  private head = 0;
  private _size = 0;

  readonly capacity: number;

  constructor(optionsOrCapacity: RingBufferOptions | number = {}) {
    const rawCap =
      typeof optionsOrCapacity === "number"
        ? optionsOrCapacity
        : (optionsOrCapacity.capacity ?? DEFAULT_CAPACITY);
    if (!Number.isFinite(rawCap) || rawCap < 1) {
      throw new RangeError(`RingBuffer capacity must be ≥ 1, got ${rawCap}`);
    }
    this.capacity = Math.floor(rawCap);
    this.buf = new Array(this.capacity);
  }

  get size(): number {
    return this._size;
  }

  get length(): number {
    return this._size;
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  get isEmpty(): boolean {
    return this._size === 0;
  }

  get isFull(): boolean {
    return this._size === this.capacity;
  }

  push(item: T): T | undefined {
    let evicted: T | undefined;
    if (this._size === this.capacity) {
      evicted = this.buf[this.head];
    } else {
      this._size++;
    }
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    return evicted;
  }

  latest(): T | undefined {
    if (this._size === 0) return undefined;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buf[idx];
  }

  toArray(): T[] {
    return this._collect(false);
  }

  drain(): T[] {
    return this._collect(true);
  }

  snapshot(): T[] {
    return this._collect(false);
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this._size = 0;
  }

  private _collect(clear: boolean): T[] {
    if (this._size === 0) return [];
    const tail = (this.head - this._size + this.capacity) % this.capacity;
    const out: T[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      out[i] = this.buf[(tail + i) % this.capacity] as T;
    }
    if (clear) this.clear();
    return out;
  }
}

export interface RegistryOptions {
  defaultCapacity?: number;
  topicCapacities?: Record<string, number>;
  maxTopics?: number;
}

export class TopicRegistry {
  private readonly buffers = new Map<string, RingBuffer<RealtimeFrame>>();
  private readonly defaultCapacity: number;
  private readonly topicCapacities: Record<string, number>;
  private readonly maxTopics: number;
  private _seq = 0;
  droppedTopics = 0;

  constructor(options: RegistryOptions = {}) {
    this.defaultCapacity = options.defaultCapacity ?? DEFAULT_CAPACITY;
    this.topicCapacities = options.topicCapacities ?? {};
    this.maxTopics = options.maxTopics ?? MAX_GLOBAL_TOPICS;
  }

  record(topic: string, payload: unknown): RealtimeFrame | undefined {
    if (!this.buffers.has(topic)) {
      if (this.buffers.size >= this.maxTopics) {
        this.droppedTopics++;
        return undefined;
      }
      const cap = this.topicCapacities[topic] ?? this.defaultCapacity;
      this.buffers.set(topic, new RingBuffer<RealtimeFrame>({ capacity: cap }));
    }
    const frame: RealtimeFrame = {
      topic,
      payload,
      receivedAt: Date.now(),
      seq: this._seq++,
    };
    this.buffers.get(topic)!.push(frame);
    return frame;
  }

  snapshot(topic: string): RealtimeFrame[] {
    return this.buffers.get(topic)?.snapshot() ?? [];
  }

  drain(topic: string): RealtimeFrame[] {
    return this.buffers.get(topic)?.drain() ?? [];
  }

  drainAll(): RealtimeFrame[] {
    const all: RealtimeFrame[] = [];
    for (const buf of this.buffers.values()) {
      all.push(...buf.drain());
    }
    return all.sort((a, b) => a.seq - b.seq);
  }

  snapshotAll(): RealtimeFrame[] {
    const all: RealtimeFrame[] = [];
    for (const buf of this.buffers.values()) {
      all.push(...buf.snapshot());
    }
    return all.sort((a, b) => a.seq - b.seq);
  }

  get topics(): string[] {
    return Array.from(this.buffers.keys());
  }

  reset(): void {
    this.buffers.clear();
    this._seq = 0;
    this.droppedTopics = 0;
  }

  get totalBuffered(): number {
    let n = 0;
    for (const buf of this.buffers.values()) n += buf.size;
    return n;
  }

  get seq(): number {
    return this._seq;
  }
}
