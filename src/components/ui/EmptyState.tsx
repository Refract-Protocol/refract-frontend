import type { ReactNode } from "react";
import { Card } from "./Card";

/**
 * Props for {@link EmptyState}.
 */
export interface EmptyStateProps {
  /** Decorative icon rendered inside a circle. Hidden from assistive tech. */
  icon?: ReactNode;
  /** Short headline describing the empty condition. */
  title: ReactNode;
  /** Optional supporting copy explaining what to do next. */
  description?: ReactNode;
  /** Primary call to action. */
  action?: ReactNode;
  /** Secondary call to action rendered beneath the primary one. */
  secondaryAction?: ReactNode;
  /** Extra classes merged onto the wrapping card. */
  className?: string;
}

/**
 * Centered placeholder for lists and sections that have no data to show.
 *
 * Composes on top of {@link Card} so panel styling stays consistent, and
 * reuses the emoji-in-circle motif used elsewhere in the app. The wrapper is
 * marked `aria-live="polite"` so a list transitioning from loading to empty
 * is announced to assistive technology.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <Card
      padding="lg"
      className={["flex flex-col items-center text-center", className]
        .filter(Boolean)
        .join(" ")}
      aria-live="polite"
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-pm-bg text-2xl"
        >
          {icon}
        </span>
      ) : null}
      <h3 className="text-base font-semibold text-pm-text">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-pm-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
      {secondaryAction ? (
        <div className="mt-3">{secondaryAction}</div>
      ) : null}
    </Card>
  );
}
