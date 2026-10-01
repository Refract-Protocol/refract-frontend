import type { ReactNode } from "react";
import { Card } from "./Card";

/**
 * Props for {@link ErrorState}.
 */
export interface ErrorStateProps {
  /** Decorative icon rendered inside a circle. Hidden from assistive tech. */
  icon?: ReactNode;
  /** Short headline describing the failure. */
  title: ReactNode;
  /** Optional supporting copy explaining the failure. */
  description?: ReactNode;
  /** Primary call to action. */
  action?: ReactNode;
  /** Secondary call to action rendered beneath the primary one. */
  secondaryAction?: ReactNode;
  /**
   * Retry callback. When provided a retry button is rendered; when absent the
   * button is hidden so callers without refetch plumbing can still adopt the
   * primitive.
   */
  onRetry?: () => void;
  /** Label for the retry button. */
  retryLabel?: string;
  /** Extra classes merged onto the wrapping card. */
  className?: string;
}

/**
 * Centered placeholder for sections that failed to load.
 *
 * Composes on top of {@link Card} and always offers a retry affordance when an
 * `onRetry` callback is supplied. The wrapper is marked `role="alert"` so the
 * failure is announced to assistive technology.
 */
export function ErrorState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <Card
      padding="lg"
      className={[
        "flex flex-col items-center text-center border-pm-red/30 !bg-pm-red/[0.04]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="alert"
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-pm-red/10 text-2xl"
        >
          {icon}
        </span>
      ) : null}
      <h3 className="text-base font-semibold text-pm-text">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-pm-muted">{description}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-md bg-pm-red px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-red/90"
        >
          {retryLabel}
        </button>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
      {secondaryAction ? (
        <div className="mt-3">{secondaryAction}</div>
      ) : null}
    </Card>
  );
}
