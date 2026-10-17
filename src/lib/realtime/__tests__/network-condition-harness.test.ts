import { describe, expect, it } from 'vitest';
import { NetworkConditionRealtimeHarness } from '../network-condition-harness';

describe('NetworkConditionRealtimeHarness', () => {
  it('verifies hard_offline disables transport and activates REST fallback and degraded banner', () => {
    const harness = new NetworkConditionRealtimeHarness();
    harness.subscribe('claims.updated');

    const offlineState = harness.setNetworkProfile('hard_offline');
    // Guard against vacuous offline fixture
    expect(offlineState.transportActive).toBe(false);
    expect(offlineState.restFallbackActive).toBe(true);
    expect(offlineState.degradedBannerVisible).toBe(true);

    const pushRes = harness.pushServerFrame({
      eventId: 'evt-1',
      topic: 'claims.updated',
      sequence: 1,
      payload: { status: 'approved' },
    });
    expect(pushRes.deliveredOverSocket).toBe(false);
    expect(harness.getState().deliveredEvents).toHaveLength(0);

    // Offline-to-online recovery resubscribes, clears stale banner, and delivers missed events
    const recovered = harness.setNetworkProfile('normal');
    expect(recovered.transportActive).toBe(true);
    expect(recovered.restFallbackActive).toBe(false);
    expect(recovered.degradedBannerVisible).toBe(false);
    expect(recovered.deliveredEvents.map((e) => e.eventId)).toEqual(['evt-1']);
  });

  it('handles high_latency and packet_loss without duplicate or dropped events after recovery', () => {
    const harness = new NetworkConditionRealtimeHarness();
    harness.subscribe('policies.updated');

    const highLat = harness.setNetworkProfile('high_latency');
    expect(highLat.degradedBannerVisible).toBe(true);
    expect(highLat.restFallbackActive).toBe(true);

    harness.setNetworkProfile('packet_loss');
    harness.pushServerFrame({
      eventId: 'p-1',
      topic: 'policies.updated',
      sequence: 1,
      payload: {},
    });
    harness.pushServerFrame({
      eventId: 'p-2',
      topic: 'policies.updated',
      sequence: 2,
      payload: {},
    });
    harness.pushServerFrame({
      eventId: 'p-3',
      topic: 'policies.updated',
      sequence: 3,
      payload: {},
    });

    // Reconcile dropped frame via REST fallback, then recover to normal without duplicates
    const reconciledCount = harness.runRestFallbackPoll();
    expect(reconciledCount).toBe(1);

    const finalState = harness.setNetworkProfile('normal');
    expect(finalState.degradedBannerVisible).toBe(false);
    expect(finalState.deliveredEvents.map((e) => e.eventId)).toEqual([
      'p-1',
      'p-2',
      'p-3',
    ]);
  });
});
