"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface TourStep {
  /** Matches a `data-tour-id` attribute on the element to spotlight. */
  target: string;
  title: string;
  content: string;
}

const STORAGE_PREFIX = "refract:tour-seen:";
const SPOTLIGHT_PADDING = 6;
const TOOLTIP_GAP = 12;
const VIEWPORT_MARGIN = 16;

/** Next step index when moving `direction` steps, or null once the tour is finished. */
export function stepAfter(index: number, total: number, direction: 1 | -1): number | null {
  const next = index + direction;
  if (next >= total) return null;
  return Math.max(0, next);
}

export function hasSeenTour(tourId: string, storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(STORAGE_PREFIX + tourId) === "1";
  } catch {
    // Storage blocked — treat as seen so the tour doesn't pop up on every visit.
    return true;
  }
}

export function markTourSeen(tourId: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(STORAGE_PREFIX + tourId, "1");
  } catch {
    // Storage blocked — nothing to persist.
  }
}

/** Opens the tour automatically on the first visit per browser; `start` replays it. */
export function useTour(tourId: string) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hasSeenTour(tourId)) setOpen(true);
  }, [tourId]);

  const start = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    markTourSeen(tourId);
    setOpen(false);
  }, [tourId]);

  return { open, start, close };
}

interface TourProps {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
}

/**
 * Spotlights one element per step with an attached tooltip. The overlay is
 * a single box-shadow cut-out with `pointer-events: none`, so the page stays
 * fully interactive — the tour points at controls without blocking them.
 */
export function Tour({ steps, open, onClose }: TourProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const step = steps[index];

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Track the target's position, re-measuring on scroll, resize and any
  // layout shift (e.g. a validation message appearing above it).
  useEffect(() => {
    if (!open || !step) return;
    const target = document.querySelector<HTMLElement>(`[data-tour-id="${step.target}"]`);
    const measure = () => {
      setRect(target ? target.getBoundingClientRect() : null);
      setTooltipHeight(tooltipRef.current?.offsetHeight ?? 0);
    };
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (open) tooltipRef.current?.focus();
  }, [open, index]);

  if (!open || !step) return null;

  const go = (direction: 1 | -1) => {
    const next = stepAfter(index, steps.length, direction);
    if (next === null) onClose();
    else setIndex(next);
  };

  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;
  const tooltipWidth = Math.min(320, vw - VIEWPORT_MARGIN * 2);
  let tooltipStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + SPOTLIGHT_PADDING + TOOLTIP_GAP;
    const fitsBelow = below + tooltipHeight <= vh - VIEWPORT_MARGIN;
    const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, rect.top - SPOTLIGHT_PADDING - TOOLTIP_GAP - tooltipHeight);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), vw - tooltipWidth - VIEWPORT_MARGIN);
    tooltipStyle = { top, left, width: tooltipWidth };
  } else {
    tooltipStyle = { top: "50%", left: "50%", width: tooltipWidth, transform: "translate(-50%, -50%)" };
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-[100] rounded-[10px] transition-all duration-200"
        style={
          rect
            ? {
                top: rect.top - SPOTLIGHT_PADDING,
                left: rect.left - SPOTLIGHT_PADDING,
                width: rect.width + SPOTLIGHT_PADDING * 2,
                height: rect.height + SPOTLIGHT_PADDING * 2,
                boxShadow: "0 0 0 9999px rgba(7,5,15,0.7)",
              }
            : { inset: 0, background: "rgba(7,5,15,0.7)" }
        }
      />
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
        className="fixed z-[101] rounded-[10px] border border-pm-violet/30 bg-pm-bg p-4 shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-pm-violet"
        style={tooltipStyle}
      >
        <div className="mb-1 text-[11px] uppercase tracking-wide text-pm-text/40">
          Step {index + 1} of {steps.length}
        </div>
        <h2 id={titleId} className="mb-1.5 font-display text-[15px] font-bold text-pm-text">
          {step.title}
        </h2>
        <p className="mb-4 text-[13px] leading-relaxed text-pm-text/60">{step.content}</p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.target} className={`h-1.5 w-1.5 rounded-full ${i === index ? "bg-pm-violet" : "bg-white/15"}`} />
            ))}
          </div>
          <div className="flex gap-2 text-[12px]">
            <button type="button" onClick={onClose} className="px-2 py-1 text-pm-text/45">
              Skip
            </button>
            {index > 0 && (
              <button type="button" onClick={() => go(-1)} className="rounded border border-pm-border px-2.5 py-1 text-pm-text">
                Back
              </button>
            )}
            <button type="button" onClick={() => go(1)} className="rounded bg-pm-violet px-2.5 py-1 font-semibold text-white">
              {index === steps.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
        <div aria-live="polite" className="sr-only">
          Step {index + 1} of {steps.length}: {step.title}. {step.content}
        </div>
      </div>
    </>
  );
}

/** Small "?" affordance to replay a page's tour. */
export function TourReplayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Replay page tour"
      title="Replay tour"
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-pm-violet/30 text-[12px] font-bold text-pm-violet"
    >
      ?
    </button>
  );
}
