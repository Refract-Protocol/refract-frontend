"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import type { BadgeTone } from "./Badge";

/**
 * Visual tone for a toast. Mirrors {@link BadgeTone} so status colours stay
 * consistent across the app.
 */
export type ToastTone = BadgeTone;

/**
 * A single toast notification rendered inside the {@link ToastProvider} stack.
 */
export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  /** Short headline for the notification. */
  title: string;
  /** Optional supporting copy. */
  description?: ReactNode;
  /** Colour tone; `danger` is announced assertively. */
  tone?: ToastTone;
  /** Optional action element (e.g. a retry button). */
  action?: ReactNode;
  /** Called when the user dismisses the toast. */
  onDismiss?: () => void;
}

const toneClass: Record<ToastTone, string> = {
  safe: "pm-tag-safe",
  risk: "pm-tag-risk",
  danger: "pm-tag-danger",
  violet: "pm-tag-violet",
  neutral: "pm-tag-neutral",
};

/**
 * Presentational toast card. Layout, stacking and timers are owned by
 * {@link ToastProvider}; this component only renders a single entry.
 */
export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
  { title, description, tone = "neutral", action, onDismiss, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="status"
      className={[
        "pm-panel pointer-events-auto flex w-full max-w-sm items-start gap-3 p-4 shadow-lg",
        toneClass[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="mt-1 text-sm opacity-80">{description}</p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="shrink-0 rounded p-1 text-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        ×
      </button>
    </div>
  );
});
