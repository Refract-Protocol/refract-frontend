"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export interface SuccessBurstProps {
  /** Whether the burst is currently visible. */
  active?: boolean;
  /** Optional label rendered alongside the burst. */
  label?: string;
  /** Called after the burst animation completes. */
  onComplete?: () => void;
}

/**
 * Celebratory burst shown after a successful action.
 *
 * Honors the user's reduced-motion preference: when set, the burst renders
 * a static state with no animation classes and completes immediately.
 */
export function SuccessBurst({ active = true, label, onComplete }: SuccessBurstProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    setVisible(active);
  }, [active]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (prefersReducedMotion) {
      onComplete?.();
      return;
    }

    const timer = window.setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [visible, prefersReducedMotion, onComplete]);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        prefersReducedMotion
          ? "flex items-center gap-2 text-sm font-medium text-emerald-600"
          : "flex items-center gap-2 text-sm font-medium text-emerald-600 animate-burst"
      }
    >
      <span
        aria-hidden="true"
        className={prefersReducedMotion ? "text-lg" : "text-lg animate-pop"}
      >
        ✓
      </span>
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export default SuccessBurst;
