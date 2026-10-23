import { decodeFrame, type DecodeResult } from "./decode";

export interface WorkerRequest {
  id: number;
  raw: string;
}

export interface WorkerResponse {
  id: number;
  result: DecodeResult;
}

/** The subset of `Worker` the decoder relies on, so tests can inject a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
}

export type DecodeMode = "worker" | "main";

export interface FrameDecoderOptions {
  /** Returns a worker, or null when workers are unavailable. Defaults to the bundled decoder worker. */
  createWorker?: () => WorkerLike | null;
  /** Frames at least this long always go to the worker. */
  largeFrameBytes?: number;
  /** At or above this rate (frames/sec), frames >= `smallFrameBytes` also go to the worker. */
  highRatePerSec?: number;
  /** Frames shorter than this always stay on the main thread: cloning them costs more than parsing. */
  smallFrameBytes?: number;
  /** A worker that does not answer within this window is treated as crashed. */
  workerTimeoutMs?: number;
  now?: () => number;
  onFallback?: (reason: string) => void;
}

export interface DecoderStats {
  mode: DecodeMode;
  decodedOnWorker: number;
  decodedOnMain: number;
  fallbackReason: string | null;
}

const DEFAULTS = {
  largeFrameBytes: 16 * 1024,
  highRatePerSec: 50,
  smallFrameBytes: 512,
  workerTimeoutMs: 2_000,
};

function defaultCreateWorker(): WorkerLike | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  // webpack 5 (Next.js) bundles this pattern into a separate worker chunk.
  return new Worker(new URL("./decoder.worker.ts", import.meta.url), {
    type: "module",
    name: "realtime-decoder",
  }) as unknown as WorkerLike;
}

/**
 * Decides per frame whether to decode on the main thread or in the worker.
 *
 * - Workers are created lazily, on the first frame worth offloading.
 * - If the worker fails to start, errors, or stops answering, the decoder
 *   falls back to the main thread permanently for the session and re-decodes
 *   any frames that were in flight, so nothing is lost.
 * - Returns a plain value for main-thread decodes and a Promise for worker
 *   decodes; callers preserve frame order (see `OrderedQueue`).
 */
export class FrameDecoder {
  private worker: WorkerLike | null = null;
  private workerDisabled = false;
  private nextId = 1;
  private pending = new Map<number, { raw: string; resolve: (r: DecodeResult) => void }>();
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private rateWindowStart = 0;
  private rateCount = 0;
  private currentRate = 0;
  private readonly opts: Required<Omit<FrameDecoderOptions, "onFallback">> &
    Pick<FrameDecoderOptions, "onFallback">;
  readonly stats: DecoderStats = {
    mode: "main",
    decodedOnWorker: 0,
    decodedOnMain: 0,
    fallbackReason: null,
  };

  constructor(options: FrameDecoderOptions = {}) {
    this.opts = {
      createWorker: options.createWorker ?? defaultCreateWorker,
      largeFrameBytes: options.largeFrameBytes ?? DEFAULTS.largeFrameBytes,
      highRatePerSec: options.highRatePerSec ?? DEFAULTS.highRatePerSec,
      smallFrameBytes: options.smallFrameBytes ?? DEFAULTS.smallFrameBytes,
      workerTimeoutMs: options.workerTimeoutMs ?? DEFAULTS.workerTimeoutMs,
      now: options.now ?? (() => Date.now()),
      onFallback: options.onFallback,
    };
  }

  decode(input: unknown): DecodeResult | Promise<DecodeResult> {
    if (typeof input !== "string") return this.decodeOnMain(input);
    this.trackRate();
    if (!this.shouldOffload(input)) return this.decodeOnMain(input);
    const worker = this.ensureWorker();
    if (!worker) return this.decodeOnMain(input);

    const id = this.nextId++;
    return new Promise<DecodeResult>((resolve) => {
      this.pending.set(id, { raw: input, resolve });
      try {
        worker.postMessage({ id, raw: input });
        this.armWatchdog();
      } catch (err) {
        this.fallBack(`postMessage failed: ${String(err)}`);
      }
    });
  }

  dispose(): void {
    this.clearWatchdog();
    this.worker?.terminate();
    this.worker = null;
    // Settle anything still in flight so the ordered queue can drain.
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.resolve(this.decodeOnMain(entry.raw));
    }
  }

  private shouldOffload(raw: string): boolean {
    if (this.workerDisabled) return false;
    if (raw.length < this.opts.smallFrameBytes) return false;
    if (raw.length >= this.opts.largeFrameBytes) return true;
    return this.currentRate >= this.opts.highRatePerSec;
  }

  private trackRate(): void {
    const now = this.opts.now();
    const elapsed = now - this.rateWindowStart;
    if (elapsed >= 1_000) {
      // The previous window only describes the current rate if it just ended.
      this.currentRate = elapsed < 2_000 ? this.rateCount : 0;
      this.rateCount = 0;
      this.rateWindowStart = now;
    }
    this.rateCount += 1;
    // Within the first window, react as soon as the rate is evidently high.
    this.currentRate = Math.max(this.currentRate, this.rateCount);
  }

  private ensureWorker(): WorkerLike | null {
    if (this.workerDisabled) return null;
    if (this.worker) return this.worker;
    let worker: WorkerLike | null;
    try {
      worker = this.opts.createWorker();
    } catch (err) {
      this.fallBack(`worker failed to start: ${String(err)}`);
      return null;
    }
    if (!worker) {
      this.fallBack("workers unavailable");
      return null;
    }
    worker.onmessage = (event) => this.handleResponse(event.data);
    worker.onerror = () => this.fallBack("worker crashed");
    worker.onmessageerror = () => this.fallBack("worker message could not be deserialized");
    this.worker = worker;
    this.stats.mode = "worker";
    return worker;
  }

  private handleResponse(response: WorkerResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    this.stats.decodedOnWorker += 1;
    if (this.pending.size === 0) this.clearWatchdog();
    else this.armWatchdog(true);
    entry.resolve(response.result);
  }

  private fallBack(reason: string): void {
    if (this.workerDisabled) return;
    this.workerDisabled = true;
    this.stats.mode = "main";
    this.stats.fallbackReason = reason;
    this.opts.onFallback?.(reason);
    this.dispose();
  }

  private armWatchdog(restart = false): void {
    if (this.watchdog && !restart) return;
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (this.pending.size > 0) this.fallBack("worker stopped responding");
    }, this.opts.workerTimeoutMs);
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private decodeOnMain(input: unknown): DecodeResult {
    this.stats.decodedOnMain += 1;
    return decodeFrame(input);
  }
}

/**
 * Delivers results in submission order even when some are synchronous and
 * others resolve later from the worker. Synchronous results with nothing
 * queued ahead of them are delivered immediately (no microtask hop).
 */
export class OrderedQueue<T> {
  private slots: Array<{ done: boolean; value?: T }> = [];
  private generation = 0;

  constructor(private readonly deliver: (value: T) => void) {}

  push(value: T | Promise<T>): void {
    if (!(value instanceof Promise)) {
      if (this.slots.length === 0) {
        this.deliver(value);
        return;
      }
      this.slots.push({ done: true, value });
      return;
    }
    const slot: { done: boolean; value?: T } = { done: false };
    const generation = this.generation;
    this.slots.push(slot);
    void value.then((resolved) => {
      if (generation !== this.generation) return;
      slot.done = true;
      slot.value = resolved;
      this.flush();
    });
  }

  /** Drops anything not yet delivered (e.g. on disconnect). */
  clear(): void {
    this.slots = [];
    this.generation += 1;
  }

  get size(): number {
    return this.slots.length;
  }

  private flush(): void {
    while (this.slots.length > 0 && this.slots[0]!.done) {
      const slot = this.slots.shift()!;
      this.deliver(slot.value as T);
    }
  }
}
