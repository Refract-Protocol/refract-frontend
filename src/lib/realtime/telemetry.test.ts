/**
 * Tests for the OpenTelemetry instrumentation shim around the realtime client.
 * Closes #237.
 *
 * Strategy: inject no-op but spy-able tracer/meter doubles so no real OTel SDK
 * is required. This validates that:
 *   - Every lifecycle event calls the right tracer/meter method.
 *   - Counter increments and histogram records are called with the right values.
 *   - The shim never throws — instrumentation must not regress the app.
 *   - Fallback behaviour works correctly when @opentelemetry/api is absent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealtimeTracer } from "./telemetry";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeSpan() {
  return {
    end: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    setAttribute: vi.fn(),
  };
}

function makeTracer() {
  const span = makeSpan();
  return {
    span,
    startSpan: vi.fn(() => span),
  };
}

function makeMeter() {
  const counter = { add: vi.fn() };
  const upDown = { add: vi.fn() };
  const histogram = { record: vi.fn() };
  return {
    counter,
    upDown,
    histogram,
    createCounter: vi.fn(() => counter),
    createUpDownCounter: vi.fn(() => upDown),
    createHistogram: vi.fn(() => histogram),
  };
}

// ---------------------------------------------------------------------------
// RealtimeTracer via factory
// ---------------------------------------------------------------------------

describe("RealtimeTracer", () => {
  let tracer: ReturnType<typeof makeTracer>;
  let meter: ReturnType<typeof makeMeter>;
  let rt: RealtimeTracer;

  beforeEach(() => {
    tracer = makeTracer();
    meter = makeMeter();
    rt = RealtimeTracer.withBackends(tracer, meter);
  });

  // ── Connection lifecycle ─────────────────────────────────────────────────

  it("onConnectAttempt increments connectAttempts counter", () => {
    rt.onConnectAttempt("ws://localhost/ws", 0);
    expect(meter.counter.add).toHaveBeenCalledWith(1, expect.objectContaining({ attempt: 0 }));
  });

  it("onConnectAttempt starts a connect span on first attempt", () => {
    rt.onConnectAttempt("ws://localhost/ws", 0);
    expect(tracer.startSpan).toHaveBeenCalledWith(
      "realtime connect",
      expect.objectContaining({
        attributes: expect.objectContaining({ "net.peer.address": "ws://localhost/ws" }),
      })
    );
  });

  it("onConnectAttempt does NOT start a second span if one is already open", () => {
    rt.onConnectAttempt("ws://localhost/ws", 0);
    rt.onConnectAttempt("ws://localhost/ws", 1); // second attempt before first closes
    expect(tracer.startSpan).toHaveBeenCalledTimes(1);
  });

  it("onConnectError increments connectErrors counter and ends span", () => {
    rt.onConnectAttempt("ws://localhost/ws", 0);
    rt.onConnectError("ws://localhost/ws", new Error("refused"));
    expect(meter.counter.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ "net.peer.address": "ws://localhost/ws" })
    );
    expect(tracer.span.end).toHaveBeenCalled();
    expect(tracer.span.recordException).toHaveBeenCalled();
  });

  it("onOpen sets the 'connected' attribute on the active span", () => {
    rt.onConnectAttempt("ws://localhost/ws", 0);
    rt.onOpen("ws://localhost/ws");
    expect(tracer.span.setAttribute).toHaveBeenCalledWith("connected", true);
  });

  it("onClose ends the span and records session duration", () => {
    rt.onConnectAttempt("ws://localhost/ws", 0);
    rt.onOpen("ws://localhost/ws");
    rt.onClose("ws://localhost/ws");
    expect(tracer.span.end).toHaveBeenCalled();
    expect(meter.histogram.record).toHaveBeenCalledWith(expect.any(Number));
  });

  it("onError increments connectErrors (without an active span)", () => {
    rt.onError("ws://localhost/ws");
    expect(meter.counter.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ "net.peer.address": "ws://localhost/ws" })
    );
  });

  // ── Reconnects ────────────────────────────────────────────────────────────

  it("onReconnectScheduled increments reconnects counter with delay and attempt attributes", () => {
    rt.onReconnectScheduled(2000, 1);
    expect(meter.counter.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ attempt: 1, delay_ms: 2000 })
    );
  });

  // ── Messages ─────────────────────────────────────────────────────────────

  it("onMessage increments messages counter with topic attribute", () => {
    rt.onMessage("oracle_update");
    expect(meter.counter.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ topic: "oracle_update" })
    );
  });

  it("onMessage starts and immediately ends a 'realtime message' span", () => {
    rt.onMessage("oracle_update");
    expect(tracer.startSpan).toHaveBeenCalledWith(
      "realtime message",
      expect.objectContaining({ attributes: expect.objectContaining({ topic: "oracle_update" }) })
    );
    expect(tracer.span.end).toHaveBeenCalled();
  });

  // ── Subscribers ───────────────────────────────────────────────────────────

  it("onSubscribe adds 1 to the upDownCounter for the topic", () => {
    rt.onSubscribe("oracle_update", 1);
    expect(meter.upDown.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ topic: "oracle_update" })
    );
  });

  it("onUnsubscribe subtracts 1 from the upDownCounter for the topic", () => {
    rt.onSubscribe("oracle_update", 1);
    rt.onUnsubscribe("oracle_update", 0);
    expect(meter.upDown.add).toHaveBeenLastCalledWith(
      -1,
      expect.objectContaining({ topic: "oracle_update" })
    );
  });

  // ── Disconnect ────────────────────────────────────────────────────────────

  it("onDisconnect records session duration", () => {
    rt.onConnectAttempt("ws://localhost/ws", 0);
    rt.onDisconnect();
    expect(meter.histogram.record).toHaveBeenCalledWith(expect.any(Number));
  });

  it("onDisconnect is safe to call without a prior connect", () => {
    expect(() => rt.onDisconnect()).not.toThrow();
  });

  // ── Fallback ─────────────────────────────────────────────────────────────

  it("onFallbackActivated increments fallback counter with reason attribute", () => {
    rt.onFallbackActivated("realtime-oracle flag disabled");
    expect(meter.counter.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ reason: "realtime-oracle flag disabled" })
    );
  });

  it("onFallbackActivated emits a 'realtime fallback' span", () => {
    rt.onFallbackActivated("ws unavailable");
    expect(tracer.startSpan).toHaveBeenCalledWith(
      "realtime fallback",
      expect.objectContaining({ attributes: expect.objectContaining({ reason: "ws unavailable" }) })
    );
    expect(tracer.span.end).toHaveBeenCalled();
  });

  // ── Meter initialisation ─────────────────────────────────────────────────

  it("creates all expected metrics on construction", () => {
    expect(meter.createCounter).toHaveBeenCalledWith(
      "realtime.connect.attempts",
      expect.any(Object)
    );
    expect(meter.createCounter).toHaveBeenCalledWith("realtime.connect.errors", expect.any(Object));
    expect(meter.createCounter).toHaveBeenCalledWith("realtime.reconnects", expect.any(Object));
    expect(meter.createCounter).toHaveBeenCalledWith("realtime.messages", expect.any(Object));
    expect(meter.createUpDownCounter).toHaveBeenCalledWith(
      "realtime.subscribe.active",
      expect.any(Object)
    );
    expect(meter.createCounter).toHaveBeenCalledWith(
      "realtime.fallback.activations",
      expect.any(Object)
    );
    expect(meter.createHistogram).toHaveBeenCalledWith(
      "realtime.session.duration_ms",
      expect.any(Object)
    );
  });
});

// ---------------------------------------------------------------------------
// NOOP fallback — instrumentation must never throw even if OTel is absent
// ---------------------------------------------------------------------------

describe("RealtimeTracer no-op safety", () => {
  it("module-level singleton does not throw during construction", async () => {
    // The singleton is already imported in the module under test;
    // re-importing it here ensures that even in a test environment without
    // an OTel SDK it initialises without error.
    await expect(import("./telemetry")).resolves.toBeDefined();
  });

  it("all lifecycle methods are safe to call on the singleton", async () => {
    const { realtimeTracer } = await import("./telemetry");
    expect(() => {
      realtimeTracer.onConnectAttempt("ws://test", 0);
      realtimeTracer.onOpen("ws://test");
      realtimeTracer.onMessage("oracle_update");
      realtimeTracer.onSubscribe("oracle_update", 1);
      realtimeTracer.onUnsubscribe("oracle_update", 0);
      realtimeTracer.onReconnectScheduled(1000, 1);
      realtimeTracer.onError("ws://test");
      realtimeTracer.onClose("ws://test");
      realtimeTracer.onFallbackActivated("test");
      realtimeTracer.onDisconnect();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Counter/histogram call counts through a full connection lifecycle
// ---------------------------------------------------------------------------

describe("RealtimeTracer: full lifecycle event counts", () => {
  it("single connect→message→disconnect cycle emits the right number of calls", () => {
    const tracer = makeTracer();
    const meter = makeMeter();
    const rt = RealtimeTracer.withBackends(tracer, meter);

    // Full lifecycle.
    rt.onConnectAttempt("ws://localhost/ws", 0);
    rt.onOpen("ws://localhost/ws");
    rt.onSubscribe("oracle_update", 1);
    rt.onMessage("oracle_update");
    rt.onMessage("oracle_update");
    rt.onUnsubscribe("oracle_update", 0);
    rt.onClose("ws://localhost/ws");

    // connectAttempts=1, messages=2 → counter.add called 3 times total
    // (1 connect + 2 message) plus upDown calls (2) = 5 total counter.add + upDown.add calls
    const counterCalls = meter.counter.add.mock.calls.length;
    const upDownCalls = meter.upDown.add.mock.calls.length;
    expect(counterCalls).toBeGreaterThanOrEqual(3); // at minimum: 1 connect + 2 messages
    expect(upDownCalls).toBe(2); // subscribe + unsubscribe
    expect(meter.histogram.record).toHaveBeenCalledTimes(1); // onClose
  });
});
