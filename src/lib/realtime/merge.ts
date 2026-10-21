export type EventKind = "replace" | "append";

/** Wire envelope. `seq` is per-topic and monotonic; `kind` defaults to "replace". */
export interface Envelope {
  topic: string;
  seq?: number;
  kind?: EventKind;
  payload: unknown;
}

export const REORDER_WINDOW = 32;
export const MAX_APPEND_BUFFER = 5_000;

/**
 * Per-topic ordering: delivers envelopes in `seq` order, buffers out-of-order
 * arrivals up to `window`, drops duplicates, and reports a gap (via `onGap`)
 * once the window overflows or `flush()` is called with a hole outstanding.
 */
export class TopicSequencer {
  private last: number | null = null;
  private buffer = new Map<number, Envelope>();

  constructor(
    private readonly onGap: (fromSeq: number, toSeq: number) => void,
    private readonly window = REORDER_WINDOW
  ) {}

  push(env: Envelope): Envelope[] {
    const seq = env.seq;
    if (seq === undefined) return [env];
    if (this.last === null) this.last = seq - 1;
    if (seq <= this.last) return []; // duplicate / already delivered
    this.buffer.set(seq, env);
    const out = this.drain();
    if (this.buffer.size > this.window) out.push(...this.skipGap());
    return out;
  }

  /** Force-resolve an outstanding hole (e.g. after a timeout): flags the gap and releases what is buffered. */
  flush(): Envelope[] {
    return this.buffer.size ? this.skipGap() : [];
  }

  private drain(): Envelope[] {
    const out: Envelope[] = [];
    for (let next = this.last! + 1, e = this.buffer.get(next); e; next += 1, e = this.buffer.get(next)) {
      this.buffer.delete(next);
      this.last = next;
      out.push(e);
    }
    return out;
  }

  private skipGap(): Envelope[] {
    const lowest = Math.min(...this.buffer.keys());
    this.onGap(this.last! + 1, lowest - 1);
    this.last = lowest - 1;
    return this.drain();
  }
}

/**
 * Bounds how often consumers are notified. "replace" events keep only the
 * latest per topic (drop-oldest); "append" events are always queued in order
 * and never dropped.
 */
export class Coalescer {
  private replace = new Map<string, unknown>();
  private append = new Map<string, unknown[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deliver: (topic: string, payload: unknown) => void,
    private readonly intervalMs = 50
  ) {}

  add(env: Envelope): void {
    if (env.kind === "append") {
      const q = this.append.get(env.topic) ?? [];
      q.push(env.payload);
      this.append.set(env.topic, q);
      // Backpressure: a slow consumer gets an early flush rather than losing events.
      if (q.length >= MAX_APPEND_BUFFER) return this.flush();
    } else {
      this.replace.set(env.topic, env.payload);
    }
    this.timer ??= setTimeout(() => this.flush(), this.intervalMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const appends = this.append;
    const replaces = this.replace;
    this.append = new Map();
    this.replace = new Map();
    appends.forEach((q, topic) => q.forEach((p) => this.deliver(topic, p)));
    replaces.forEach((p, topic) => this.deliver(topic, p));
  }
}
