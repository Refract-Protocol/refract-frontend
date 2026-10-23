/**
 * Detects OS sleep/wake, bfcache restore and long background suspensions —
 * cases where the socket looks open but is dead. Combines three signals:
 * timer wall-clock drift, `pageshow` (persisted) and long hidden→visible gaps.
 */

export const WAKE_TICK_MS = 5_000;
/** A tick arriving this much later than scheduled means the machine was suspended. */
export const WAKE_DRIFT_MS = 30_000;
/** Hidden for at least this long counts as a suspension on return. */
export const LONG_HIDDEN_MS = 60_000;
/** Wake signals closer together than this collapse into one. */
const DEDUPE_MS = 2_000;

export class WakeDetector {
  private lastTick: number;
  private hiddenAt: number | null = null;
  private lastWake = 0;

  constructor(private readonly onWake: (reason: string) => void) {
    this.lastTick = Date.now();
  }

  private fire(reason: string): void {
    const now = Date.now();
    if (now - this.lastWake < DEDUPE_MS) return;
    this.lastWake = now;
    this.lastTick = now;
    this.onWake(reason);
  }

  tick(): void {
    const now = Date.now();
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (gap > WAKE_TICK_MS + WAKE_DRIFT_MS) this.fire("clock-drift");
  }

  pageShow(persisted: boolean): void {
    if (persisted) this.fire("bfcache");
  }

  visibility(visible: boolean): void {
    const now = Date.now();
    if (!visible) {
      this.hiddenAt = now;
      return;
    }
    const hiddenFor = this.hiddenAt === null ? 0 : now - this.hiddenAt;
    this.hiddenAt = null;
    if (hiddenFor >= LONG_HIDDEN_MS) this.fire("long-hidden");
    // Short backgrounds (incl. iOS Safari app switches) are intentionally ignored.
  }
}

/** Wires a WakeDetector to the browser; returns a teardown function. */
export function startWakeDetector(onWake: (reason: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const detector = new WakeDetector(onWake);
  const timer = setInterval(() => detector.tick(), WAKE_TICK_MS);
  const onPageShow = (e: PageTransitionEvent) => detector.pageShow(e.persisted);
  const onVisibility = () => detector.visibility(document.visibilityState === "visible");
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearInterval(timer);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
