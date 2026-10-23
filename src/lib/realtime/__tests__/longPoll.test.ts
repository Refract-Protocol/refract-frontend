import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LongPollTransport, type VisibilitySource } from "../transports/longPoll";
import type { TransportCallbacks } from "../transports/types";

type Responder = (url: URL, signal: AbortSignal) => Promise<Response>;

/** A fetch mock that answers each request with the next queued responder. */
function mockFetch() {
  const queue: Responder[] = [];
  const calls: URL[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    // An aborted request no longer occupies the connection, even though its
    // promise settles a tick later.
    let settled = false;
    const done = () => {
      if (!settled) inFlight -= 1;
      settled = true;
    };
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    init!.signal!.addEventListener("abort", done);
    const responder = queue.shift() ?? hang;
    return responder(url, init!.signal!).finally(done);
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
    respond: (...r: Responder[]) => queue.push(...r),
  };
}

const json =
  (body: unknown, init: ResponseInit = {}) =>
  async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
      ...init,
    });
const status =
  (code: number, headers: Record<string, string> = {}) =>
  async () =>
    new Response(null, { status: code, headers });
const hang: Responder = (_url, signal) =>
  new Promise((_, reject) =>
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
  );

function callbacks() {
  const frames: unknown[] = [];
  const cb = {
    frames,
    onOpen: vi.fn(),
    onFrame: vi.fn((f: unknown) => frames.push(f)),
    onClose: vi.fn(),
  } satisfies TransportCallbacks & { frames: unknown[] };
  return cb;
}

function makeTransport(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof LongPollTransport>[0]> = {}
) {
  return new LongPollTransport({
    url: "http://api.test/api/v1/realtime/poll",
    fetchImpl,
    visibility: null,
    defaultTimeoutMs: 1_000,
    timeoutGraceMs: 500,
    backoffBaseMs: 100,
    ...extra,
  });
}

const ctx = (cursors: Record<string, number> = {}) => ({
  topics: ["oracle_update"],
  getCursors: () => cursors,
});

describe("LongPollTransport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("handshakes, delivers events in order and re-polls with the latest cursor", async () => {
    const f = mockFetch();
    const cursors: Record<string, number> = {};
    f.respond(
      json({ events: [], cursors: { oracle_update: 4 }, timeoutMs: 1_000 }),
      json({ events: [{ topic: "oracle_update", id: "a", seq: 5, payload: 1 }] })
    );
    const cb = callbacks();
    // Stand in for the client, which applies each event's seq as it arrives.
    cb.onFrame.mockImplementation((frame: unknown) => {
      cb.frames.push(frame);
      const { topic, seq } = frame as { topic?: string; seq?: number };
      if (topic && seq !== undefined) cursors[topic] = seq;
    });
    const t = makeTransport(f.fetchImpl);
    t.connect({ topics: ["oracle_update"], getCursors: () => cursors }, cb);
    await vi.advanceTimersByTimeAsync(0);

    expect(cb.onOpen).toHaveBeenCalledTimes(1);
    expect(cb.frames[0]).toEqual({ type: "subscribed", topics: ["oracle_update"], gap: undefined });
    expect(cb.frames[1]).toMatchObject({ id: "a", seq: 5 });
    expect(f.calls[0]!.searchParams.get("topics")).toBe("oracle_update");
    expect(f.calls[0]!.searchParams.get("after")).toBeNull();
    // Handshake cursor is used until the client applies its own.
    expect(f.calls[1]!.searchParams.get("after")).toBe("oracle_update:4");
    expect(f.calls[2]!.searchParams.get("after")).toBe("oracle_update:5");
    t.disconnect();
  });

  it("sends credentials through the same base URL as REST", async () => {
    const f = mockFetch();
    makeTransport(f.fetchImpl).connect(ctx(), callbacks());
    expect(f.fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("http://api.test/api/v1/realtime/poll?"),
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
  });

  it("aborts a request held past the server timeout and polls again", async () => {
    const f = mockFetch();
    const t = makeTransport(f.fetchImpl);
    const cb = callbacks();
    t.connect(ctx({ oracle_update: 1 }), cb);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.stats.timeouts).toBe(1);
    expect(f.calls).toHaveLength(2);
    expect(cb.onClose).not.toHaveBeenCalled();
    t.disconnect();
  });

  it("honours the timeout the server advertises", async () => {
    const f = mockFetch();
    f.respond(json({ events: [], timeoutMs: 10_000 }));
    const t = makeTransport(f.fetchImpl);
    t.connect(ctx({ oracle_update: 1 }), callbacks());
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.stats.timeouts).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(t.stats.timeouts).toBe(1);
    t.disconnect();
  });

  it("disconnect aborts the in-flight request and stops polling", async () => {
    const f = mockFetch();
    let aborted = false;
    f.respond((_u, signal) => {
      signal.addEventListener("abort", () => (aborted = true));
      return hang(_u, signal);
    });
    const cb = callbacks();
    const t = makeTransport(f.fetchImpl);
    t.connect(ctx(), cb);
    t.disconnect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(aborted).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(cb.onClose).not.toHaveBeenCalled();
  });

  it("backs off exponentially on 5xx and honours Retry-After on 429", async () => {
    const f = mockFetch();
    f.respond(status(503), status(502), status(429, { "Retry-After": "2" }));
    const t = makeTransport(f.fetchImpl);
    t.connect(ctx({ oracle_update: 1 }), callbacks());
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100); // 1st backoff
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // 2nd backoff: 200ms
    expect(f.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_999); // Retry-After 2s beats 400ms backoff
    expect(f.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(4);
    t.disconnect();
  });

  it("reports closed after too many consecutive failures", async () => {
    const f = mockFetch();
    f.respond(status(500), status(500), status(500));
    const cb = callbacks();
    makeTransport(f.fetchImpl, { maxConsecutiveFailures: 3 }).connect(ctx(), cb);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cb.onClose).toHaveBeenCalledWith(expect.objectContaining({ code: 1006 }));
    expect(f.calls).toHaveLength(3);
  });

  it("closes as an auth failure on 401 and as unsupported on 404", async () => {
    for (const [code, expected] of [
      [401, { auth: true, code: 4401 }],
      [404, { unsupported: true }],
    ] as const) {
      const f = mockFetch();
      f.respond(status(code));
      const cb = callbacks();
      makeTransport(f.fetchImpl).connect(ctx(), cb);
      await vi.advanceTimersByTimeAsync(0);
      expect(cb.onClose).toHaveBeenCalledWith(expect.objectContaining(expected));
      expect(cb.onOpen).not.toHaveBeenCalled();
    }
  });

  it("never stacks requests: a topic change aborts the in-flight poll first", async () => {
    const f = mockFetch();
    const t = makeTransport(f.fetchImpl);
    t.connect(ctx({ oracle_update: 1 }), callbacks());
    t.subscribe(["pool_stats"], {});
    t.subscribe(["claim_settled"], {});
    t.subscribe(["claim_settled"], {}); // no-op: already subscribed
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(3);
    expect(f.maxInFlight).toBe(1);
    expect(f.calls[2]!.searchParams.get("topics")).toBe("oracle_update,pool_stats,claim_settled");
    t.disconnect();
  });

  it("pauses while the tab is hidden and resumes once visible", async () => {
    let hidden = false;
    const listeners = new Set<() => void>();
    const visibility: VisibilitySource = {
      isHidden: () => hidden,
      onChange: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const f = mockFetch();
    const t = makeTransport(f.fetchImpl, { visibility });
    t.connect(ctx({ oracle_update: 1 }), callbacks());
    expect(t.stats.inFlight).toBe(1);

    hidden = true;
    listeners.forEach((l) => l());
    expect(t.stats.inFlight).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.calls).toHaveLength(1);

    hidden = false;
    listeners.forEach((l) => l());
    listeners.forEach((l) => l()); // duplicate event must not stack a second request
    expect(f.calls).toHaveLength(2);
    expect(f.maxInFlight).toBe(1);

    t.disconnect();
    expect(listeners.size).toBe(0);
  });
});
