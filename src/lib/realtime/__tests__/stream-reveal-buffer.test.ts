import { describe, expect, it } from 'vitest';
import { StreamRevealBuffer } from '../stream-reveal-buffer';

describe('StreamRevealBuffer', () => {
  it('auto-reveals incoming items when scrolled to top on a visible tab', () => {
    const buffer = new StreamRevealBuffer([{ id: 'tx-1', timestampMs: 1_000 }]);

    const state = buffer.pushIncoming({ id: 'tx-2', timestampMs: 2_000 });
    expect(state.pendingCount).toBe(0);
    expect(state.showRevealBanner).toBe(false);
    expect(state.visibleItems.map((i) => i.id)).toEqual(['tx-2', 'tx-1']);
  });

  it('buffers incoming items when scrolled down or tab hidden and commits in order on reveal', () => {
    const buffer = new StreamRevealBuffer([{ id: 'tx-1', timestampMs: 1_000 }]);
    buffer.setScrollPosition(false);

    buffer.pushIncoming({ id: 'tx-2', timestampMs: 2_000 });
    const mid = buffer.pushIncoming({ id: 'tx-3', timestampMs: 3_000 });
    // Duplicate is ignored
    buffer.pushIncoming({ id: 'tx-2', timestampMs: 2_000 });

    expect(mid.pendingCount).toBe(2);
    expect(mid.showRevealBanner).toBe(true);
    expect(mid.revealBannerLabel).toBe('2 new updates available');
    expect(mid.visibleItems.map((i) => i.id)).toEqual(['tx-1']);

    const revealed = buffer.revealPending();
    expect(revealed.pendingCount).toBe(0);
    expect(revealed.showRevealBanner).toBe(false);
    expect(revealed.visibleItems.map((i) => i.id)).toEqual(['tx-3', 'tx-2', 'tx-1']);
  });

  it('bounds the pending buffer and respects prefers-reduced-motion', () => {
    const buffer = new StreamRevealBuffer([], {
      maxBufferSize: 2,
      prefersReducedMotion: true,
    });
    buffer.setTabVisibility(false);

    buffer.pushIncoming({ id: 'a', timestampMs: 100 });
    buffer.pushIncoming({ id: 'b', timestampMs: 200 });
    const state = buffer.pushIncoming({ id: 'c', timestampMs: 300 });

    expect(state.pendingCount).toBe(2);
    expect(state.animateReveal).toBe(false);

    const committed = buffer.revealPending();
    expect(committed.visibleItems.map((i) => i.id)).toEqual(['c', 'b']);
  });
});
