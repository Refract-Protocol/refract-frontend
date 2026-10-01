import { cn } from "@/lib/cn";

export type BadgeTone = "safe" | "risk" | "danger" | "violet" | "neutral";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

const toneClass: Record<BadgeTone, string> = {
  safe: "pm-tag-safe",
  risk: "pm-tag-risk",
  danger: "pm-tag-danger",
  violet: "pm-tag-violet",
  neutral: "bg-white/5 text-pm-muted",
};

/**
 * Tone tokens shared with `toneClass`. Each tone maps to a CSS custom property
 * (`--pm-tone-*`) defined in `globals.css`, so the dot colour stays in sync with
 * the pill styling and can be theme-swapped instead of duplicating hex literals.
 */
const dotVar: Record<BadgeTone, string> = {
  safe: "var(--pm-tone-safe)",
  risk: "var(--pm-tone-risk)",
  danger: "var(--pm-tone-danger)",
  violet: "var(--pm-tone-violet)",
  neutral: "var(--pm-tone-neutral)",
};

/** Status pill built on `.pm-tag`. Use `dot` for a live-status indicator. */
export function Badge({ tone = "neutral", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn("pm-tag", toneClass[tone], className)} {...rest}>
      {dot && (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: "50%", background: dotVar[tone] }}
        />
      )}
      {children}
    </span>
  );
}
