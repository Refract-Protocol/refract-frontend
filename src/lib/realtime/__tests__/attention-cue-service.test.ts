import { describe, expect, it, vi } from 'vitest';
import {
  AttentionCueService,
  WebAudioContextLike,
} from '../attention-cue-service';

function createMockAudioContext(): WebAudioContextLike & {
  oscillatorsStarted: number;
  closedCount: number;
} {
  const ctx = {
    state: 'suspended' as 'suspended' | 'running' | 'closed',
    currentTime: 0,
    destination: {},
    oscillatorsStarted: 0,
    closedCount: 0,
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
      ctx.closedCount += 1;
    }),
    createOscillator: () => ({
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(() => {
        ctx.oscillatorsStarted += 1;
      }),
      stop: vi.fn(),
    }),
  };
  return ctx;
}

describe('AttentionCueService', () => {
  it('defaults audio off, drops events before user gesture unlock, and suppresses non-critical/backfill events', async () => {
    const mockCtx = createMockAudioContext();
    const vibrate = vi.fn(() => true);
    const service = new AttentionCueService({
      createAudioContext: () => mockCtx,
      vibrateFn: vibrate,
    });

    // Default preferences are off
    expect(
      service.triggerCue({ eventId: 'e1', severity: 'critical' }).suppressedReason
    ).toBe('preferences_disabled');

    service.updatePreferences({ audioEnabled: true });

    // Before user gesture unlock, audio cue is dropped rather than queued
    expect(
      service.triggerCue({ eventId: 'e2', severity: 'critical' }).suppressedReason
    ).toBe('audio_locked');

    await service.unlockFromUserGesture();
    expect(mockCtx.state).toBe('running');

    // Non-critical and backfill events are suppressed
    expect(
      service.triggerCue({ eventId: 'e3', severity: 'info' }).suppressedReason
    ).toBe('non_critical_severity');
    expect(
      service.triggerCue({
        eventId: 'e4',
        severity: 'critical',
        isBackfill: true,
      }).suppressedReason
    ).toBe('backfill_event');
    expect(mockCtx.oscillatorsStarted).toBe(0);
  });

  it('plays synthesized audio and haptics for critical events, coalesces bursts, and respects quiet hours / reduced motion', async () => {
    let now = 10_000;
    const mockCtx = createMockAudioContext();
    const vibrate = vi.fn(() => true);
    const service = new AttentionCueService({
      initialPreferences: { audioEnabled: true, hapticsEnabled: true },
      createAudioContext: () => mockCtx,
      vibrateFn: vibrate,
      coalesceWindowMs: 1_500,
      nowFn: () => now,
    });

    await service.unlockFromUserGesture();

    const first = service.triggerCue({ eventId: 'c1', severity: 'critical' });
    expect(first.playedAudio).toBe(true);
    expect(first.triggeredHaptics).toBe(true);
    expect(mockCtx.oscillatorsStarted).toBe(1);
    expect(vibrate).toHaveBeenCalledTimes(1);

    // Burst within 1500ms coalesces
    now = 10_500;
    const burst = service.triggerCue({ eventId: 'c2', severity: 'critical' });
    expect(burst.suppressedReason).toBe('coalesced_burst');
    expect(mockCtx.oscillatorsStarted).toBe(1);

    // Quiet hours and reduced motion suppress cues
    now = 15_000;
    service.updatePreferences({ quietHoursActive: true });
    expect(
      service.triggerCue({ eventId: 'c3', severity: 'critical' }).suppressedReason
    ).toBe('quiet_hours');

    service.updatePreferences({
      quietHoursActive: false,
      prefersReducedMotion: true,
    });
    expect(
      service.triggerCue({ eventId: 'c4', severity: 'critical' }).suppressedReason
    ).toBe('reduced_motion');

    // Clean teardown closes AudioContext without leaking
    await service.dispose();
    expect(mockCtx.closedCount).toBe(1);
  });
});
