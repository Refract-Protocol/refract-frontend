import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFrame, type DecodeResult } from "../decode";
import {
  FrameDecoder,
  OrderedQueue,
  type WorkerLike,
  type WorkerRequest,
  type WorkerResponse,
} from "../frameDecoder";
import { MAX_FRAME_BYTES } from "../topics";

/** Frames covering every decode outcome; shared by the parity tests. */
const FIXTURES: Array<[string, string]> = [
  [
    "oracle event",
    JSON.stringify({ topic: "oracle_update", id: "o-1", seq: 1, payload: { value: 0.999 } }),
  ],
  ["event without id", JSON.stringify({ topic: "pool_stats", seq: 3, payload: { tvl: 10 } })],
  [
    "event padded topic",
    JSON.stringify({ topic: "  claim_settled  ", id: "c-9", seq: 9, payload: null }),
  ],
  [
    "subscribed ack",
    JSON.stringify({ type: "subscribed", topics: ["oracle_update"], gap: ["oracle_update"] }),
  ],
  ["auth error", JSON.stringify({ type: "error", code: "auth_failed" })],
  ["ping", JSON.stringify({ type: "ping" })],
  ["invalid json", "{not json"],
  ["array frame", "[1,2,3]"],
  ["missing topic", JSON.stringify({ id: "x", payload: 1 })],
  ["negative seq", JSON.stringify({ topic: "oracle_update", id: "x", seq: -1, payload: 1 })],
  ["bad topic chars", JSON.stringify({ topic: "a b", payload: 1 })],
  ["unknown control", JSON.stringify({ type: "nope" })],
  ["too large", JSON.stringify({ topic: "t", payload: "x".repeat(MAX_FRAME_BYTES) })],
];

/**
 * Behaves like the real worker: structured-clones across the boundary and
 * runs the same pure decodeFrame, answering asynchronously.
 */
function createFakeWorker(opts: { crashOn?: string; silent?: boolean } = {}) {
  const posted: WorkerRequest[] = [];
  const worker: WorkerLike & { posted: WorkerRequest[] } = {
    posted,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      const request = structuredClone(message);
      posted.push(request);
      if (opts.silent) return;
      setTimeout(() => {
        if (opts.crashOn && request.raw.includes(opts.crashOn)) {
          worker.onerror?.(new Event("error"));
          return;
        }
        const response: WorkerResponse = structuredClone({
          id: request.id,
          result: decodeFrame(request.raw),
        });
        worker.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
      }, 1);
    },
    terminate: vi.fn(),
  };
  return worker;
}

describe("decodeFrame", () => {
  it("normalizes valid events and control frames", () => {
    const result = decodeFrame(FIXTURES[2]![1]);
    expect(result).toEqual({
      ok: true,
      message: { kind: "event", topic: "claim_settled", id: "c-9", seq: 9, payload: null },
    });
    expect(decodeFrame(FIXTURES[3]![1])).toMatchObject({
      ok: true,
      message: { kind: "control", type: "subscribed" },
    });
  });

  it("returns typed failures instead of throwing", () => {
    expect(decodeFrame("{not json")).toMatchObject({ ok: false, error: { kind: "invalid_json" } });
    expect(decodeFrame("[1]")).toMatchObject({ ok: false, error: { kind: "invalid_shape" } });
    expect(decodeFrame(FIXTURES[12]![1])).toMatchObject({
      ok: false,
      error: { kind: "too_large" },
    });
  });

  it("accepts already-parsed objects (long-poll batches)", () => {
    expect(decodeFrame({ topic: "pool_stats", id: "p", seq: 1, payload: 2 })).toMatchObject({
      ok: true,
    });
  });
});

describe("FrameDecoder worker/main parity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(FIXTURES)("%s decodes identically on both paths", async (_name, raw) => {
    const main = new FrameDecoder({ createWorker: () => null }).decode(raw);
    // Force everything (even tiny frames) through the worker.
    const worker = createFakeWorker();
    const offloading = new FrameDecoder({
      createWorker: () => worker,
      smallFrameBytes: 0,
      largeFrameBytes: 0,
    });
    const pending = offloading.decode(raw);
    expect(pending).toBeInstanceOf(Promise);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(main);
    expect(offloading.stats.decodedOnWorker).toBe(1);
  });
});

describe("FrameDecoder routing and fallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const small = JSON.stringify({ topic: "oracle_update", id: "1", payload: 1 });
  const large = JSON.stringify({ topic: "oracle_update", id: "2", payload: "x".repeat(20_000) });

  it("keeps small frames on the main thread and offloads large ones", () => {
    const worker = createFakeWorker();
    const decoder = new FrameDecoder({ createWorker: () => worker });
    expect(decoder.decode(small)).not.toBeInstanceOf(Promise);
    expect(decoder.decode(large)).toBeInstanceOf(Promise);
    expect(worker.posted).toHaveLength(1);
  });

  it("offloads medium frames only once the message rate is high", () => {
    let now = 0;
    const worker = createFakeWorker();
    const medium = JSON.stringify({ topic: "oracle_update", payload: "y".repeat(1_000) });
    const decoder = new FrameDecoder({
      createWorker: () => worker,
      highRatePerSec: 5,
      now: () => now,
    });
    for (let i = 0; i < 4; i++) expect(decoder.decode(medium)).not.toBeInstanceOf(Promise);
    expect(decoder.decode(medium)).toBeInstanceOf(Promise);
    now += 5_000; // quiet period resets the rate
    decoder.decode(medium);
    expect(decoder.decode(medium)).not.toBeInstanceOf(Promise);
  });

  it("falls back to the main thread when workers are unavailable", () => {
    const decoder = new FrameDecoder({ createWorker: () => null });
    expect(decoder.decode(large)).toMatchObject({ ok: true });
    expect(decoder.stats).toMatchObject({ mode: "main", fallbackReason: "workers unavailable" });
  });

  it("falls back when the worker fails to start", () => {
    const decoder = new FrameDecoder({
      createWorker: () => {
        throw new Error("CSP blocked");
      },
    });
    expect(decoder.decode(large)).toMatchObject({ ok: true });
    expect(decoder.stats.fallbackReason).toContain("CSP blocked");
  });

  it("re-decodes in-flight frames and stays on main thread for the session after a crash", async () => {
    const worker = createFakeWorker({ crashOn: '"id":"2"' });
    const onFallback = vi.fn();
    const decoder = new FrameDecoder({ createWorker: () => worker, onFallback });
    const pending = decoder.decode(large);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: true, message: { id: "2" } });
    expect(onFallback).toHaveBeenCalledWith("worker crashed");
    expect(worker.terminate).toHaveBeenCalled();
    expect(decoder.decode(large)).not.toBeInstanceOf(Promise);
  });

  it("treats an unresponsive worker as crashed", async () => {
    const worker = createFakeWorker({ silent: true });
    const decoder = new FrameDecoder({ createWorker: () => worker, workerTimeoutMs: 100 });
    const pending = decoder.decode(large);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: true });
    expect(decoder.stats.fallbackReason).toBe("worker stopped responding");
  });
});

describe("OrderedQueue", () => {
  it("delivers in submission order across sync and async results", async () => {
    const delivered: number[] = [];
    const queue = new OrderedQueue<number>((n) => delivered.push(n));
    let resolveSlow!: (n: number) => void;
    queue.push(1);
    queue.push(new Promise<number>((r) => (resolveSlow = r)));
    queue.push(3);
    queue.push(Promise.resolve(4));
    expect(delivered).toEqual([1]);
    resolveSlow(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(delivered).toEqual([1, 2, 3, 4]);
  });

  it("drops undelivered results on clear()", async () => {
    const delivered: DecodeResult[] = [];
    const queue = new OrderedQueue<DecodeResult>((r) => delivered.push(r));
    queue.push(Promise.resolve(decodeFrame("{}")));
    queue.clear();
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toEqual([]);
  });
});
