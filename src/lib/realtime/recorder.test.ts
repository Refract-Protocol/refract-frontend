/**
 * Tests for the frame recorder and deterministic replay engine.
 * Closes #236.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  FrameRecorder,
  serializeRecording,
  deserializeRecording,
  replayRecording,
  replaySync,
  type Recording,
  type LifecycleEvent,
  type CapturedFrame,
} from "./recorder";
import type { RealtimeFrame } from "./ringBuffer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(topic: string, seq: number, payload?: unknown): RealtimeFrame {
  return { topic, payload: payload ?? { seq }, receivedAt: Date.now(), seq };
}

/** Minimal replay target that exposes the internal `handlers` map. */
function makeTarget() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    handlers,
    subscribe(topic: string, handler: (p: unknown) => void) {
      if (!handlers.has(topic)) handlers.set(topic, new Set());
      handlers.get(topic)!.add(handler);
      return () => handlers.get(topic)?.delete(handler);
    },
  };
}

// ---------------------------------------------------------------------------
// FrameRecorder
// ---------------------------------------------------------------------------

describe("FrameRecorder", () => {
  let recorder: FrameRecorder;

  beforeEach(() => {
    recorder = new FrameRecorder();
  });

  it("starts inactive", () => {
    expect(recorder.isRecording).toBe(false);
  });

  it("becomes active after start()", () => {
    recorder.start();
    expect(recorder.isRecording).toBe(true);
  });

  it("is idempotent on start()", () => {
    recorder.start();
    recorder.recordLifecycle("connect_attempt", {});
    recorder.start(); // second call — should not reset
    expect(recorder.peek()).toHaveLength(1);
  });

  it("records frames when active", () => {
    recorder.start();
    recorder.recordFrame(makeFrame("oracle_update", 0, { value: 1.0 }));
    recorder.recordFrame(makeFrame("oracle_update", 1, { value: 1.1 }));
    expect(recorder.peek()).toHaveLength(2);
  });

  it("records lifecycle events when active", () => {
    recorder.start();
    recorder.recordLifecycle("open", { wsUrl: "ws://localhost/ws" });
    const entries = recorder.peek();
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("lifecycle");
    expect((entries[0] as LifecycleEvent).event).toBe("open");
  });

  it("does nothing when not active", () => {
    recorder.recordFrame(makeFrame("oracle_update", 0));
    recorder.recordLifecycle("open", {});
    expect(recorder.peek()).toHaveLength(0);
  });

  it("stop() returns the recording and clears internal state", () => {
    recorder.start();
    recorder.recordFrame(makeFrame("oracle_update", 0));
    recorder.recordLifecycle("close", {});
    const rec = recorder.stop();
    expect(rec.entries).toHaveLength(2);
    expect(recorder.isRecording).toBe(false);
    expect(recorder.peek()).toHaveLength(0);
  });

  it("recording includes startedAt / stoppedAt timestamps", () => {
    recorder.start();
    const rec = recorder.stop();
    expect(rec.startedAt).toBeTruthy();
    expect(rec.stoppedAt).toBeTruthy();
    expect(new Date(rec.stoppedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(rec.startedAt).getTime()
    );
  });

  it("assigns monotonically increasing seq across entry types", () => {
    recorder.start();
    recorder.recordLifecycle("connect_attempt", {});
    recorder.recordFrame(makeFrame("oracle_update", 0));
    recorder.recordLifecycle("open", {});
    const entries = recorder.peek();
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("preserves meta passed to start()", () => {
    recorder.start({ sessionId: "abc123", userAgent: "test" });
    const rec = recorder.stop();
    expect(rec.meta.sessionId).toBe("abc123");
  });
});

// ---------------------------------------------------------------------------
// Serialisation round-trip
// ---------------------------------------------------------------------------

describe("serializeRecording / deserializeRecording", () => {
  function makeRecording(): Recording {
    const recorder = new FrameRecorder();
    recorder.start();
    recorder.recordFrame(makeFrame("oracle_update", 0, { value: 1.0 }));
    recorder.recordLifecycle("open", { wsUrl: "ws://test" });
    return recorder.stop();
  }

  it("round-trips correctly", () => {
    const original = makeRecording();
    const json = serializeRecording(original);
    const parsed = deserializeRecording(json);
    expect(parsed.entries).toHaveLength(original.entries.length);
    expect(parsed.startedAt).toBe(original.startedAt);
  });

  it("deserializeRecording throws on invalid JSON", () => {
    expect(() => deserializeRecording("not json")).toThrow(SyntaxError);
  });

  it("deserializeRecording throws when entries is not an array", () => {
    expect(() =>
      deserializeRecording(
        JSON.stringify({ startedAt: "", stoppedAt: "", entries: null, meta: {} })
      )
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// replaySync
// ---------------------------------------------------------------------------

describe("replaySync", () => {
  it("dispatches frame payloads to subscribed handlers", () => {
    const recorder = new FrameRecorder();
    recorder.start();
    recorder.recordFrame(makeFrame("oracle_update", 0, { value: 1.0 }));
    recorder.recordFrame(makeFrame("oracle_update", 1, { value: 1.1 }));
    const rec = recorder.stop();

    const received: unknown[] = [];
    const target = makeTarget();
    target.subscribe("oracle_update", (p) => received.push(p));

    replaySync(rec, target);
    expect(received).toHaveLength(2);
    expect((received[0] as { value: number }).value).toBe(1.0);
    expect((received[1] as { value: number }).value).toBe(1.1);
  });

  it("dispatches frames in seq order regardless of entry insertion order", () => {
    const recorder = new FrameRecorder();
    recorder.start();
    // Manually insert a lifecycle event between two frames.
    recorder.recordFrame(makeFrame("oracle_update", 0, { idx: 0 }));
    recorder.recordLifecycle("reconnect_scheduled", { delayMs: 1000 });
    recorder.recordFrame(makeFrame("oracle_update", 1, { idx: 1 }));
    const rec = recorder.stop();

    const received: unknown[] = [];
    const lifecycle: string[] = [];
    const target = makeTarget();
    target.subscribe("oracle_update", (p) => received.push(p));

    replaySync(rec, target, {
      onLifecycle: (e) => lifecycle.push(e.event),
    });

    expect(received).toHaveLength(2);
    expect(lifecycle).toEqual(["reconnect_scheduled"]);
  });

  it("calls onLifecycle for lifecycle entries", () => {
    const recorder = new FrameRecorder();
    recorder.start();
    recorder.recordLifecycle("open", { wsUrl: "ws://test" });
    recorder.recordLifecycle("close", { wsUrl: "ws://test" });
    const rec = recorder.stop();

    const events: string[] = [];
    replaySync(rec, makeTarget(), {
      onLifecycle: (e) => events.push(e.event),
    });
    expect(events).toEqual(["open", "close"]);
  });

  it("handles an empty recording gracefully", () => {
    const recorder = new FrameRecorder();
    recorder.start();
    const rec = recorder.stop();
    expect(() => replaySync(rec, makeTarget())).not.toThrow();
  });

  it("topics with no subscribers receive no errors", () => {
    const recorder = new FrameRecorder();
    recorder.start();
    recorder.recordFrame(makeFrame("unsubscribed_topic", 0));
    const rec = recorder.stop();
    expect(() => replaySync(rec, makeTarget())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// replayRecording (async / timing-aware)
// ---------------------------------------------------------------------------

describe("replayRecording", () => {
  it("dispatches all frames when preserveTiming=false", async () => {
    const recorder = new FrameRecorder();
    recorder.start();
    for (let i = 0; i < 5; i++) {
      recorder.recordFrame(makeFrame("oracle_update", i, { i }));
    }
    const rec = recorder.stop();

    const received: unknown[] = [];
    const target = makeTarget();
    target.subscribe("oracle_update", (p) => received.push(p));

    await replayRecording(rec, target, { preserveTiming: false });
    expect(received).toHaveLength(5);
  });

  it("calls onLifecycle callbacks during async replay", async () => {
    const recorder = new FrameRecorder();
    recorder.start();
    recorder.recordLifecycle("open", {});
    recorder.recordFrame(makeFrame("oracle_update", 0));
    recorder.recordLifecycle("close", {});
    const rec = recorder.stop();

    const lifecycle: string[] = [];
    await replayRecording(rec, makeTarget(), {
      preserveTiming: false,
      onLifecycle: (e) => lifecycle.push(e.event),
    });
    expect(lifecycle).toEqual(["open", "close"]);
  });

  it("resolves immediately for an empty recording", async () => {
    const recorder = new FrameRecorder();
    recorder.start();
    const rec = recorder.stop();
    await expect(replayRecording(rec, makeTarget())).resolves.toBeUndefined();
  });

  it("speed multiplier reduces inter-frame delay", async () => {
    vi.useFakeTimers();

    const recorder = new FrameRecorder();
    recorder.start();
    const now = Date.now();
    // Two frames 1 second apart.
    recorder.recordFrame({ topic: "t", payload: {}, receivedAt: now, seq: 0 });
    recorder.recordFrame({ topic: "t", payload: {}, receivedAt: now + 1000, seq: 1 });
    const rec = recorder.stop();

    const received: unknown[] = [];
    const target = makeTarget();
    target.subscribe("t", (p) => received.push(p));

    const promise = replayRecording(rec, target, { preserveTiming: true, speed: 1000 });
    // With speed=1000 a 1s gap becomes 1ms — advance time by 1ms.
    vi.advanceTimersByTime(2);
    await promise;
    expect(received).toHaveLength(2);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Deterministic replay reproduces the same sequence as the original session
// ---------------------------------------------------------------------------

describe("recording → replay determinism", () => {
  it("replay produces the same payload sequence as the original session", () => {
    const payloads = [
      { coverageType: "StablecoinDepeg", value: 1.0 },
      { coverageType: "MarketCrash", value: -5.0 },
      { coverageType: "SmartContractRisk", value: -2.0 },
    ];

    // Simulate a live session.
    const recorder = new FrameRecorder();
    recorder.start();
    const liveReceived: unknown[] = [];
    const sessionHandler = (p: unknown) => liveReceived.push(p);
    for (const [i, payload] of payloads.entries()) {
      // Pretend the WS dispatched these to the handler.
      sessionHandler(payload);
      recorder.recordFrame(makeFrame("oracle_update", i, payload));
    }
    const rec = recorder.stop();

    // Replay.
    const replayReceived: unknown[] = [];
    const target = makeTarget();
    target.subscribe("oracle_update", (p) => replayReceived.push(p));
    replaySync(rec, target);

    expect(replayReceived).toEqual(liveReceived);
  });

  it("serialise→deserialise→replay round-trip preserves payload equality", () => {
    const recorder = new FrameRecorder();
    recorder.start();
    recorder.recordFrame(makeFrame("oracle_update", 0, { value: 42.0, severity: "triggered" }));
    const rec = recorder.stop();

    const json = serializeRecording(rec);
    const restored = deserializeRecording(json);

    const received: unknown[] = [];
    const target = makeTarget();
    target.subscribe("oracle_update", (p) => received.push(p));
    replaySync(restored, target);

    expect((received[0] as { value: number }).value).toBe(42.0);
    expect((received[0] as { severity: string }).severity).toBe("triggered");
  });

  it("captured lifecycle events are preserved through serialisation", () => {
    const recorder = new FrameRecorder();
    recorder.start();
    recorder.recordLifecycle("connect_attempt", { wsUrl: "ws://localhost/ws", attempt: 0 });
    recorder.recordLifecycle("open", { wsUrl: "ws://localhost/ws" });
    const rec = recorder.stop();

    const json = serializeRecording(rec);
    const restored = deserializeRecording(json);

    const events: string[] = [];
    replaySync(restored, makeTarget(), {
      onLifecycle: (e) => events.push(e.event),
    });
    expect(events).toEqual(["connect_attempt", "open"]);
  });
});
