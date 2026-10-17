import { describe, expect, it } from 'vitest';
import {
  formatRemainingDuration,
  PolicyBoundaryEvent,
  PolicyExpiryCountdownClock,
} from '../policy-expiry-countdown-clock';

describe('PolicyExpiryCountdownClock', () => {
  it('synchronizes with server time offset so skewed client clocks compute accurate countdowns', () => {
    let clientNow = 100_000;
    const clock = new PolicyExpiryCountdownClock({
      nowFn: () => clientNow,
    });

    // Server is 5 seconds ahead of client clock
    clock.syncServerTime(105_000, clientNow);
    expect(clock.getServerNowMs()).toBe(105_000);

    const snapshot = clock.registerPolicy({
      policyId: 'pol-1',
      startTimestampMs: 100_000,
      expiryTimestampMs: 165_000,
    });

    expect(snapshot.remainingMs).toBe(60_000);
    expect(snapshot.formattedCountdown).toBe('00:01:00');
  });

  it('emits discrete boundary events at claim window start and policy expiry exactly once', () => {
    let now = 1_000;
    const events: PolicyBoundaryEvent[] = [];
    const clock = new PolicyExpiryCountdownClock({
      nowFn: () => now,
      onBoundaryEvent: (ev) => events.push(ev),
    });

    clock.registerPolicy({
      policyId: 'pol-2',
      startTimestampMs: 1_000,
      claimWindowStartMs: 5_000,
      expiryTimestampMs: 10_000,
    });

    now = 5_000;
    const snap1 = clock.tick()[0];
    expect(snap1.state).toBe('claim_window_open');
    expect(events).toHaveLength(1);
    expect(events[0].boundary).toBe('claim_window_start');

    // Repeated tick does not duplicate boundary event
    clock.tick();
    expect(events).toHaveLength(1);

    now = 12_000;
    const snap2 = clock.tick()[0];
    expect(snap2.state).toBe('expired');
    expect(snap2.remainingMs).toBe(0);
    expect(snap2.formattedCountdown).toBe('00:00:00');
    expect(events).toHaveLength(2);
    expect(events[1].boundary).toBe('policy_expired');
  });

  it('clamps negative remaining time to 0 and recomputes immediately on tab visibility resume', () => {
    let now = 10_000;
    const events: PolicyBoundaryEvent[] = [];
    const clock = new PolicyExpiryCountdownClock({
      nowFn: () => now,
      prefersReducedMotion: true,
      onBoundaryEvent: (ev) => events.push(ev),
    });

    clock.registerPolicy({
      policyId: 'pol-3',
      startTimestampMs: 0,
      claimWindowStartMs: 15_000,
      expiryTimestampMs: 20_000,
    });

    clock.setTabVisibility(false);
    now = 25_000;
    const resumed = clock.setTabVisibility(true);
    expect(resumed[0].remainingMs).toBe(0);
    expect(resumed[0].progressRatio).toBe(1);
    expect(resumed[0].animateProgress).toBe(false);
    expect(events.map((e) => e.boundary)).toEqual([
      'claim_window_start',
      'policy_expired',
    ]);
    expect(formatRemainingDuration(-5000)).toBe('00:00:00');
  });
});
