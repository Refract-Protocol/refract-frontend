import { describe, it, expect } from "vitest";
import { createTopicConsumer, type TopicFrame } from "../patch";

/**
 * Transport parity matrix: the same scenarios run against every mock
 * transport mode and assert only the consumer-facing contract (emitted data,
 * resync requests), never transport internals.
 */
type Mode = "websocket" | "sse" | "long-poll";
const MODES: Mode[] = ["websocket", "sse", "long-poll"];

/** Intentional divergence: long-poll buffers frames and delivers them in batches on poll. */
const DIVERGENCES: Record<Mode, string> = {
  websocket: "frames delivered immediately",
  sse: "frames delivered immediately (framed as events)",
  "long-poll": "frames buffered server-side and delivered in batches on next poll",
};

function createMockTransport(mode: Mode) {
  const serverBuffer: unknown[] = [];
  let sink: ((f: unknown) => void) | null = null;
  let closed = false;
  let authed = true;
  const resyncs: number[] = [];
  const wire = (f: unknown) => (mode === "sse" ? JSON.parse(`${JSON.stringify(f)}`) : f);
  return {
    mode,
    connect(onFrame: (f: unknown) => void) {
      if (!authed) throw new Error("auth_failed");
      sink = onFrame;
      closed = false;
    },
    send(f: unknown) {
      if (closed) return;
      if (mode === "long-poll") serverBuffer.push(wire(f));
      else sink?.(wire(f));
    },
    /** Long-poll delivery tick; a no-op for streaming transports. */
    poll() {
      while (serverBuffer.length) sink?.(serverBuffer.shift());
    },
    flush() {
      this.poll();
    },
    close() {
      closed = true;
      sink = null;
    },
    failAuth() {
      authed = false;
    },
    requestResync() {
      resyncs.push(Date.now());
    },
    resyncs,
  };
}

const snap = (revision: number, data: Record<string, unknown>): TopicFrame => ({
  kind: "snapshot",
  revision,
  data,
});
const patch = (b: number, r: number, set: Record<string, unknown>): TopicFrame => ({
  kind: "patch",
  base_revision: b,
  revision: r,
  set,
});

const executed: Record<Mode, number> = { websocket: 0, sse: 0, "long-poll": 0 };

describe.each(MODES)("transport parity: %s", (mode) => {
  const setup = () => {
    const t = createMockTransport(mode);
    const seen: Record<string, unknown>[] = [];
    const consumer = createTopicConsumer(
      (d) => seen.push(d),
      () => t.requestResync()
    );
    t.connect((f) => consumer.push(f));
    return { t, seen, consumer };
  };

  it("subscribe + receive + ordering", () => {
    executed[mode]++;
    const { t, seen } = setup();
    t.send(snap(1, { v: 1 }));
    t.send(patch(1, 2, { v: 2 }));
    t.send(patch(2, 3, { v: 3 }));
    t.flush();
    expect(seen.at(-1)).toEqual({ v: 3 });
    expect(seen.map((s) => s.v)).toEqual([1, 2, 3]);
  });

  it("gap triggers resync and recovers on snapshot", () => {
    executed[mode]++;
    const { t, seen } = setup();
    t.send(snap(1, { v: 1 }));
    t.send(patch(5, 6, { v: 6 }));
    t.flush();
    expect(t.resyncs).toHaveLength(1);
    t.send(snap(7, { v: 7 }));
    t.flush();
    expect(seen.at(-1)).toEqual({ v: 7 });
  });

  it("duplicate frames are idempotent", () => {
    executed[mode]++;
    const { t, seen } = setup();
    t.send(snap(1, { v: 1 }));
    t.send(patch(1, 2, { v: 2 }));
    t.send(patch(1, 2, { v: 2 }));
    t.flush();
    expect(seen.map((s) => s.v)).toEqual([1, 2]);
    expect(t.resyncs).toHaveLength(0);
  });

  it("reconnect requires fresh base: patch before snapshot requests resync", () => {
    executed[mode]++;
    const { t, seen, consumer } = setup();
    t.send(snap(1, { v: 1 }));
    t.flush();
    t.close();
    consumer.reset();
    t.connect((f) => consumer.push(f));
    t.send(patch(1, 2, { v: 2 }));
    t.flush();
    expect(t.resyncs).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  it("auth failure surfaces the same error", () => {
    executed[mode]++;
    const t = createMockTransport(mode);
    t.failAuth();
    expect(() => t.connect(() => {})).toThrow("auth_failed");
  });

  it("server close and teardown deliver nothing further", () => {
    executed[mode]++;
    const { t, seen } = setup();
    t.send(snap(1, { v: 1 }));
    t.flush();
    t.close();
    t.send(snap(2, { v: 2 }));
    t.flush();
    expect(seen).toHaveLength(1);
  });

  it("documented divergence is explicit: long-poll delays delivery until poll", () => {
    executed[mode]++;
    const { t, seen } = setup();
    t.send(snap(1, { v: 1 }));
    expect(seen).toHaveLength(mode === "long-poll" ? 0 : 1);
    t.poll();
    expect(seen).toHaveLength(1);
    expect(DIVERGENCES[mode]).toBeTruthy();
  });
});

describe("matrix guard", () => {
  it("every transport executed scenarios", () => {
    for (const mode of MODES)
      expect(executed[mode], `${mode} ran zero scenarios`).toBeGreaterThan(0);
  });
});
