import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeHealthStore, type RealtimeHealth } from "@/lib/realtime/health";
import {
  createAdaptivePoller,
  MIN_HEALTHY_DWELL_MS,
  pollIntervalFor,
  StableHealth,
} from "./adaptivePolling";
import { useAdaptivePolling } from "@/hooks/useAdaptivePolling";

const MIN = 60_000;
const TOPIC = "oracle_update";

function harness(initial: RealtimeHealth, opts: { hidden?: () => boolean } = {}) {
  const health = new RealtimeHealthStore();
  health.setConnection(initial);
  const signals: AbortSignal[] = [];
  const poll = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
  });
  const poller = createAdaptivePoller({
    poll,
    tier: "critical",
    topic: TOPIC,
    health,
    isHidden: opts.hidden ?? (() => false),
  });
  poller.start();
  return { health, poll, poller, signals };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("pollIntervalFor", () => {
  it("widens when healthy and tightens when degraded or unavailable", () => {
    for (const tier of ["critical", "standard", "background"] as const) {
      const healthy = pollIntervalFor(tier, "healthy");
      const degraded = pollIntervalFor(tier, "degraded");
      const unavailable = pollIntervalFor(tier, "unavailable");
      expect(
        typeof healthy === "number" && typeof degraded === "number" && healthy > degraded
      ).toBe(true);
      expect(unavailable).toBe(degraded);
    }
  });
});

describe("createAdaptivePoller request counts", () => {
  it("unavailable: polls at the tight cadence (10 requests in 10 minutes)", async () => {
    const { poll, poller } = harness("unavailable");
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(poll).toHaveBeenCalledTimes(10);
    poller.stop();
  });

  it("degraded: polls at the tight cadence", async () => {
    const { poll, poller } = harness("degraded");
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(poll).toHaveBeenCalledTimes(10);
    poller.stop();
  });

  it("healthy: only a safety-net poll every 5 minutes (2 requests in 10 minutes)", async () => {
    const { poll, poller } = harness("healthy");
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(poll).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("tightens immediately when realtime degrades", async () => {
    const { poll, poller, health } = harness("healthy");
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(poll).toHaveBeenCalledTimes(0);
    health.setConnection("degraded");
    // The next poll is due one tight interval after the last poll (start), i.e. right away.
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(poll).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it("widens only after realtime has stayed healthy for the dwell time", async () => {
    const { poll, poller, health } = harness("unavailable");
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(poll).toHaveBeenCalledTimes(3);

    health.setConnection("healthy");
    expect(poller.interval()).toBe(MIN);
    await vi.advanceTimersByTimeAsync(MIN_HEALTHY_DWELL_MS);
    expect(poller.interval()).toBe(5 * MIN);

    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(poll).toHaveBeenCalledTimes(3 + 2);
    poller.stop();
  });

  it("flapping: a connection that keeps dropping never widens the interval", async () => {
    const { poll, poller, health } = harness("unavailable");
    for (let t = 0; t < 10 * MIN; t += 10_000) {
      health.setConnection(health.get() === "healthy" ? "degraded" : "healthy");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(poller.interval()).toBe(MIN);
    }
    expect(poll).toHaveBeenCalledTimes(10);
    poller.stop();
  });

  it("cancels the in-flight poll as soon as recovery is confirmed", async () => {
    const health = new RealtimeHealthStore();
    health.setConnection("unavailable");
    const signals: AbortSignal[] = [];
    const poller = createAdaptivePoller({
      tier: "critical",
      topic: TOPIC,
      health,
      isHidden: () => false,
      // A slow request that only ends when aborted.
      poll: (signal) =>
        new Promise<void>((resolve) => {
          signals.push(signal);
          signal.addEventListener("abort", () => resolve());
        }),
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    health.setConnection("healthy");
    await vi.advanceTimersByTimeAsync(MIN_HEALTHY_DWELL_MS);
    expect(signals[0]!.aborted).toBe(true);
    poller.stop();
  });

  it("pauses while the tab is hidden", async () => {
    let hidden = true;
    const { poll, poller } = harness("unavailable", { hidden: () => hidden });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(poll).not.toHaveBeenCalled();
    hidden = false;
    await vi.advanceTimersByTimeAsync(MIN);
    expect(poll).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("is per-topic: a topic degraded to REST polls tightly while the connection is healthy", async () => {
    const { poll, poller, health } = harness("healthy");
    health.markRestOnly(TOPIC);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(poll).toHaveBeenCalledTimes(5);
    poller.stop();
  });
});

describe("StableHealth", () => {
  it("cancels a pending improvement on relapse", () => {
    const health = new RealtimeHealthStore();
    health.setConnection("unavailable");
    const stable = new StableHealth(health, TOPIC, 1_000);
    health.setConnection("healthy");
    vi.advanceTimersByTime(900);
    health.setConnection("unavailable");
    vi.advanceTimersByTime(1_000);
    expect(stable.get()).toBe("unavailable");

    // A partial improvement also has to hold for the dwell time.
    health.setConnection("degraded");
    expect(stable.get()).toBe("unavailable");
    vi.advanceTimersByTime(1_000);
    expect(stable.get()).toBe("degraded");
    stable.dispose();
  });
});

describe("useAdaptivePolling", () => {
  function wrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children);
    };
  }

  it("returns the interval for the current health and cancels in-flight queries on recovery", async () => {
    const queryClient = new QueryClient();
    const cancel = vi.spyOn(queryClient, "cancelQueries");
    const health = new RealtimeHealthStore();
    health.setConnection("degraded");

    const { result } = renderHook(
      () =>
        useAdaptivePolling({ topic: TOPIC, tier: "standard", queryKey: ["recentClaims"], health }),
      { wrapper: wrapper(queryClient) }
    );
    expect(result.current).toBe(2 * MIN);

    act(() => health.setConnection("healthy"));
    expect(result.current).toBe(2 * MIN);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_HEALTHY_DWELL_MS);
    });
    expect(result.current).toBe(10 * MIN);
    expect(cancel).toHaveBeenCalledWith({ queryKey: ["recentClaims"] });

    act(() => health.setConnection("unavailable"));
    expect(result.current).toBe(2 * MIN);
  });
});
