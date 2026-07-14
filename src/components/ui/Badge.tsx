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

const dotColor: Record<BadgeTone, string> = {
  safe: "#10b981",
  risk: "#f59e0b",
  danger: "#ef4444",
  violet: "#8b5cf6",
  neutral: "#7b6fa8",
};

/** Status pill built on `.pm-tag`. Use `dot` for a live-status indicator. */
export function Badge({ tone = "neutral", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn("pm-tag", toneClass[tone], className)} {...rest}>
      {dot && (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor[tone] }}
        />
      )}
      {children}
    </span>
  );
}
