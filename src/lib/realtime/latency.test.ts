import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { LATENCY_BUDGET_MS } from "./latencyBudget";

class MockSocket {
  static last: MockSocket;
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor() {
    MockSocket.last = this;
  }
  addEventListener(t: string, fn: (e: unknown) => void) {
    (this.listeners[t] ??= []).push(fn);
  }
  close() {}
  emit(topic: string, payload: unknown, ts: number) {
    const data = JSON.stringify({ topic, payload, ts });
    this.listeners.message?.forEach((fn) => fn({ data }));
  }
}

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

describe("realtime latency SLO", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("delivers every topic class within its p50/p95 budget", async () => {
    const { realtimeClient } = await import("./client");
    const samples: Record<string, number[]> = {};
    for (const topic of Object.keys(LATENCY_BUDGET_MS)) {
      samples[topic] = [];
      realtimeClient.subscribe(topic, () => undefined);
    }
    for (const topic of Object.keys(LATENCY_BUDGET_MS)) {
      realtimeClient.subscribe(topic, (p) =>
        samples[topic].push(Date.now() - (p as { sentAt: number }).sentAt)
      );
    }
    for (let i = 0; i < 21; i++) {
      for (const topic of Object.keys(LATENCY_BUDGET_MS)) {
        const sentAt = Date.now();
        vi.advanceTimersByTime(20); // simulated network delay
        MockSocket.last.emit(topic, { sentAt }, sentAt);
      }
    }
    const failures: string[] = [];
    for (const [topic, budget] of Object.entries(LATENCY_BUDGET_MS)) {
      const xs = samples[topic].slice(1); // exclude warm-up event
      expect(xs.length, `no samples for ${topic}`).toBeGreaterThan(0);
      if (pct(xs, 0.5) > budget.p50) failures.push(`${topic} p50 ${pct(xs, 0.5)} > ${budget.p50}`);
      if (pct(xs, 0.95) > budget.p95)
        failures.push(`${topic} p95 ${pct(xs, 0.95)} > ${budget.p95}`);
    }
    expect(failures).toEqual([]);
  });

  it("counts wire bytes per topic and survives reconnect", async () => {
    const { realtimeClient } = await import("./client");
    const { getMetrics, sampleMetrics, utf8Length } = await import("./metrics");
    realtimeClient.subscribe("quote", () => undefined);
    const frame = JSON.stringify({ topic: "quote", payload: { a: "é" }, ts: 1 });
    MockSocket.last.emit("quote", { a: "é" }, 1);
    MockSocket.last.listeners.close?.forEach((fn) => fn({}));
    vi.advanceTimersByTime(1_000);
    MockSocket.last.emit("quote", { a: "é" }, 1);
    sampleMetrics();
    const m = getMetrics();
    expect(m.byTopic.quote.in).toBe(utf8Length(frame) * 2);
    expect(m.byTopic.quote.messages).toBe(2);
  });
});
