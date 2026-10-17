import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HeartbeatPingFrame,
  type RealtimeHeartbeatState,
  RealtimeHeartbeatMonitor,
} from "./health";

describe("RealtimeHeartbeatMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends periodic ping frames and resets deadline + RTT when pong arrives", () => {
    let clock = 1_000;
    const pings: HeartbeatPingFrame[] = [];
    const staleEvents: RealtimeHeartbeatState[] = [];

    const monitor = new RealtimeHeartbeatMonitor({
      intervalMs: 10_000,
      pongDeadlineMs: 3_000,
      maxMissedPongs: 2,
      now: () => clock,
      sendPing: (frame) => pings.push(frame),
      onStaleConnection: (state) => staleEvents.push(state),
    });

    monitor.start();
    expect(monitor.getState().healthy).toBe(true);

    clock = 11_000;
    vi.advanceTimersByTime(10_000);
    expect(pings).toHaveLength(1);
    expect(pings[0]).toEqual({
      v: 1,
      type: "ping",
      id: "hb_1",
      ts: 11_000,
    });

    // Pong arrives 120ms later
    clock = 11_120;
    vi.advanceTimersByTime(120);
    monitor.recordPong({ type: "pong", id: "hb_1", ts: 11_000, serverTs: 999_999_999 });

    const state = monitor.getState();
    expect(state.healthy).toBe(true);
    expect(state.consecutiveMisses).toBe(0);
    expect(state.lastPongAt).toBe(11_120);
    expect(state.lastRttMs).toBe(120);
    expect(staleEvents).toHaveLength(0);

    monitor.stop();
  });

  it("marks connection unhealthy and triggers onStaleConnection after N missed pongs", () => {
    let clock = 0;
    const pings: HeartbeatPingFrame[] = [];
    const staleCalls: RealtimeHeartbeatState[] = [];

    const monitor = new RealtimeHeartbeatMonitor({
      intervalMs: 5_000,
      pongDeadlineMs: 2_000,
      maxMissedPongs: 2,
      now: () => clock,
      sendPing: (f) => pings.push(f),
      onStaleConnection: (s) => staleCalls.push(s),
    });

    monitor.start();

    // First ping at t=5000, missed at t=7000
    clock = 5_000;
    vi.advanceTimersByTime(5_000);
    expect(pings).toHaveLength(1);

    clock = 7_000;
    vi.advanceTimersByTime(2_000);
    expect(monitor.getState().consecutiveMisses).toBe(1);
    expect(monitor.getState().healthy).toBe(true);
    expect(staleCalls).toHaveLength(0);

    // Second ping at t=10000, missed at t=12000 -> trips maxMissedPongs=2
    clock = 10_000;
    vi.advanceTimersByTime(3_000);
    expect(pings).toHaveLength(2);

    clock = 12_000;
    vi.advanceTimersByTime(2_000);
    expect(staleCalls).toHaveLength(1);
    expect(staleCalls[0].healthy).toBe(false);
    expect(staleCalls[0].consecutiveMisses).toBe(2);
    expect(monitor.getState().running).toBe(false);

    // No further pings after connection marked stale
    vi.advanceTimersByTime(20_000);
    expect(pings).toHaveLength(2);
  });

  it("pauses during background visibility and resumes without false reconnect storms or leaked timers", () => {
    const pings: HeartbeatPingFrame[] = [];
    const staleCalls: RealtimeHeartbeatState[] = [];

    const monitor = new RealtimeHeartbeatMonitor({
      intervalMs: 5_000,
      pongDeadlineMs: 2_000,
      maxMissedPongs: 1,
      sendPing: (f) => pings.push(f),
      onStaleConnection: (s) => staleCalls.push(s),
    });

    monitor.start();
    vi.advanceTimersByTime(5_000);
    expect(pings).toHaveLength(1);

    // Pause before deadline expires (simulating tab hidden)
    monitor.pause();
    vi.advanceTimersByTime(60_000);
    expect(staleCalls).toHaveLength(0);
    expect(pings).toHaveLength(1);

    // Resume sends immediate probe ping
    monitor.resume();
    expect(pings).toHaveLength(2);
    monitor.recordPong();

    // Stop clears all timers cleanly
    monitor.stop();
    vi.advanceTimersByTime(60_000);
    expect(pings).toHaveLength(2);
    expect(staleCalls).toHaveLength(0);
  });

  it("supports disabling heartbeat for offline dev mock flows", () => {
    const pings: HeartbeatPingFrame[] = [];
    const monitor = new RealtimeHeartbeatMonitor({
      enabled: false,
      intervalMs: 1_000,
      pongDeadlineMs: 500,
      sendPing: (f) => pings.push(f),
      onStaleConnection: () => {},
    });

    monitor.start();
    vi.advanceTimersByTime(10_000);
    expect(pings).toHaveLength(0);

    monitor.setEnabled(true);
    vi.advanceTimersByTime(1_000);
    expect(pings).toHaveLength(1);
    monitor.stop();
  });
});
