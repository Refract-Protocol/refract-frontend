import { describe, it, expect, vi, afterEach } from "vitest";
import { Coalescer, TopicSequencer, type Envelope } from "./merge";
import { SseTransport } from "./sse";

const env = (seq: number, kind: Envelope["kind"] = "replace"): Envelope => ({ topic: "t", seq, kind, payload: seq });

describe("TopicSequencer", () => {
  it("reorders within the window and drops duplicates", () => {
    const gap = vi.fn();
    const s = new TopicSequencer(gap, 8);
    expect(s.push(env(1)).map((e) => e.seq)).toEqual([1]);
    expect(s.push(env(3))).toEqual([]);
    expect(s.push(env(2)).map((e) => e.seq)).toEqual([2, 3]);
    expect(s.push(env(2))).toEqual([]);
    expect(gap).not.toHaveBeenCalled();
  });

  it("flags a gap when the window overflows", () => {
    const gap = vi.fn();
    const s = new TopicSequencer(gap, 2);
    s.push(env(1));
    s.push(env(3));
    s.push(env(4));
    const out = s.push(env(5));
    expect(gap).toHaveBeenCalledWith(2, 2);
    expect(out.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it("flush() resolves an outstanding hole", () => {
    const gap = vi.fn();
    const s = new TopicSequencer(gap);
    s.push(env(1));
    s.push(env(4));
    expect(s.flush().map((e) => e.seq)).toEqual([4]);
    expect(gap).toHaveBeenCalledWith(2, 3);
  });
});

describe("Coalescer", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps latest replace event but never drops append events", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const c = new Coalescer(deliver, 50);
    for (let i = 0; i < 5_000; i++) c.add({ topic: "oracle", kind: "replace", payload: i });
    for (let i = 0; i < 1_000; i++) c.add({ topic: "claims", kind: "append", payload: i });
    vi.advanceTimersByTime(60);
    const oracle = deliver.mock.calls.filter(([t]) => t === "oracle");
    const claims = deliver.mock.calls.filter(([t]) => t === "claims");
    expect(oracle).toEqual([["oracle", 4_999]]);
    expect(claims).toHaveLength(1_000);
  });
});

describe("SseTransport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes the token in the query and closes on error so the client owns retry", () => {
    const close = vi.fn();
    const instances: { url: string; onerror?: () => void }[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        onerror?: () => void;
        close = close;
        constructor(public url: string) {
          instances.push(this);
        }
      }
    );
    const onClose = vi.fn();
    new SseTransport("http://x/events", "http://x/sub", () => "tok").connect({ onOpen: vi.fn(), onMessage: vi.fn(), onClose });
    expect(instances[0].url).toBe("http://x/events?token=tok");
    instances[0].onerror?.();
    expect(close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
