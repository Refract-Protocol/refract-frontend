import { describe, expect, it } from 'vitest';
import {
  getSkeletonSlotDimensions,
  resolveRealtimeViewPresentation,
} from '../realtime-view-skeleton-state';

describe('realtime-view-skeleton-state', () => {
  it('renders initial_skeleton only when no data is present and never flashes skeleton during reconnects', () => {
    const initial = resolveRealtimeViewPresentation({
      hasData: false,
      isInitialRestLoading: true,
      connectionState: 'connecting',
      prefersReducedMotion: false,
    });
    expect(initial.visualState).toBe('initial_skeleton');
    expect(initial.renderSkeleton).toBe(true);
    expect(initial.renderContent).toBe(false);
    expect(initial.shimmerAnimation).toBe('pmShimmer');

    // Once data is present, reconnecting keeps content mounted without skeleton flicker
    const reconnecting = resolveRealtimeViewPresentation({
      hasData: true,
      isInitialRestLoading: false,
      connectionState: 'reconnecting',
    });
    expect(reconnecting.visualState).toBe('reconnecting_overlay');
    expect(reconnecting.renderSkeleton).toBe(false);
    expect(reconnecting.renderContent).toBe(true);
    expect(reconnecting.showSubtleReconnectIndicator).toBe(true);
  });

  it('distinguishes live_streaming, disconnected_stale, and polling_fallback states', () => {
    const live = resolveRealtimeViewPresentation({
      hasData: true,
      isInitialRestLoading: false,
      connectionState: 'connected',
    });
    expect(live.visualState).toBe('live_streaming');
    expect(live.showStaleBanner).toBe(false);

    const disconnected = resolveRealtimeViewPresentation({
      hasData: true,
      isInitialRestLoading: false,
      connectionState: 'disconnected',
    });
    expect(disconnected.visualState).toBe('disconnected_stale');
    expect(disconnected.showStaleBanner).toBe(true);

    const fallback = resolveRealtimeViewPresentation({
      hasData: true,
      isInitialRestLoading: false,
      connectionState: 'polling_fallback',
    });
    expect(fallback.visualState).toBe('polling_fallback');
    expect(fallback.renderContent).toBe(true);
  });

  it('honors prefers-reduced-motion and enforces CLS-safe slot dimensions', () => {
    const reducedInitial = resolveRealtimeViewPresentation({
      hasData: false,
      isInitialRestLoading: true,
      connectionState: 'connecting',
      prefersReducedMotion: true,
    });
    expect(reducedInitial.shimmerAnimation).toBe('none');

    const slot = getSkeletonSlotDimensions('dashboard_history', true);
    expect(slot.minHeightPx).toBe(320);
    expect(slot.rowCount).toBe(6);
    expect(slot.shimmerKeyframes).toBe('none');
  });
});
