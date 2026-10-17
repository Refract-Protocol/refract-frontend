export type RealtimeConnectionLifecycle =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'polling_fallback';

export type RealtimeViewVisualState =
  | 'initial_skeleton'
  | 'live_streaming'
  | 'reconnecting_overlay'
  | 'disconnected_stale'
  | 'polling_fallback';

export type RealtimeSectionSlot =
  | 'landing_stats'
  | 'cover_quote'
  | 'provide_pool'
  | 'dashboard_history';

export interface SkeletonSlotDimensions {
  slot: RealtimeSectionSlot;
  minHeightPx: number;
  rowCount: number;
  shimmerKeyframes: 'pmShimmer' | 'none';
}

export interface RealtimeViewStatusInput {
  hasData: boolean;
  isInitialRestLoading: boolean;
  connectionState: RealtimeConnectionLifecycle;
  prefersReducedMotion?: boolean;
}

export interface RealtimeViewPresentation {
  visualState: RealtimeViewVisualState;
  renderSkeleton: boolean;
  renderContent: boolean;
  showSubtleReconnectIndicator: boolean;
  showStaleBanner: boolean;
  shimmerAnimation: 'pmShimmer' | 'none';
  ariaBusy: boolean;
}

const SLOT_DIMENSIONS: Readonly<Record<RealtimeSectionSlot, { minHeightPx: number; rowCount: number }>> = {
  landing_stats: { minHeightPx: 140, rowCount: 4 },
  cover_quote: { minHeightPx: 220, rowCount: 3 },
  provide_pool: { minHeightPx: 260, rowCount: 5 },
  dashboard_history: { minHeightPx: 320, rowCount: 6 },
};

/**
 * Derives the deterministic loading, skeleton, and transition presentation state
 * for realtime-backed views without flashing empty skeletons once data is present.
 */
export function resolveRealtimeViewPresentation(
  input: RealtimeViewStatusInput
): RealtimeViewPresentation {
  const shimmerAnimation = input.prefersReducedMotion ? 'none' : 'pmShimmer';

  // Only show full skeleton when no data has ever been hydrated via REST or realtime
  if (!input.hasData) {
    return {
      visualState: 'initial_skeleton',
      renderSkeleton: true,
      renderContent: false,
      showSubtleReconnectIndicator: false,
      showStaleBanner: false,
      shimmerAnimation,
      ariaBusy: true,
    };
  }

  switch (input.connectionState) {
    case 'connected':
    case 'connecting':
      return {
        visualState: 'live_streaming',
        renderSkeleton: false,
        renderContent: true,
        showSubtleReconnectIndicator: false,
        showStaleBanner: false,
        shimmerAnimation: 'none',
        ariaBusy: false,
      };
    case 'reconnecting':
      return {
        visualState: 'reconnecting_overlay',
        renderSkeleton: false,
        renderContent: true,
        showSubtleReconnectIndicator: true,
        showStaleBanner: false,
        shimmerAnimation: 'none',
        ariaBusy: false,
      };
    case 'disconnected':
      return {
        visualState: 'disconnected_stale',
        renderSkeleton: false,
        renderContent: true,
        showSubtleReconnectIndicator: false,
        showStaleBanner: true,
        shimmerAnimation: 'none',
        ariaBusy: false,
      };
    case 'polling_fallback':
      return {
        visualState: 'polling_fallback',
        renderSkeleton: false,
        renderContent: true,
        showSubtleReconnectIndicator: false,
        showStaleBanner: false,
        shimmerAnimation: 'none',
        ariaBusy: false,
      };
  }
}

/**
 * Returns fixed layout dimensions for each route slot to prevent Cumulative Layout Shift (CLS).
 */
export function getSkeletonSlotDimensions(
  slot: RealtimeSectionSlot,
  prefersReducedMotion = false
): SkeletonSlotDimensions {
  const base = SLOT_DIMENSIONS[slot];
  return {
    slot,
    minHeightPx: base.minHeightPx,
    rowCount: base.rowCount,
    shimmerKeyframes: prefersReducedMotion ? 'none' : 'pmShimmer',
  };
}
