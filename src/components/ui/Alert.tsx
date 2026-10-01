import type { ReactNode } from "react";

/**
 * Visual tone of an {@link Alert}. Maps onto the existing `--pm-safe`,
 * `--pm-risk` and `--pm-danger` token families so alerts stay coherent with
 * the badge/tag styling used across the app.
 */
export type AlertTone = "info" | "warning" | "danger" | "success";

const TONE_CLASSES: Record<AlertTone, string> = {
  info: "border-pm-line bg-pm-surface text-pm-fg",
  warning: "border-pm-risk/40 bg-pm-risk/10 text-pm-fg",
  danger: "border-pm-danger/40 bg-pm-danger/10 text-pm-fg",
  success: "border-pm-safe/40 bg-pm-safe/10 text-pm-fg",
};

const TONE_ICON_CLASSES: Record<AlertTone, string> = {
  info: "text-pm-muted",
  warning: "text-pm-risk",
  danger: "text-pm-danger",
  success: "text-pm-safe",
};

const DEFAULT_ICONS: Record<AlertTone, string> = {
  info: "ℹ",
  warning: "⚠",
  danger: "⛔",
  success: "✓",
};

/**
 * Inline alert/banner primitive.
 *
 * Renders a single message with an optional title, decorative icon and action
 * slot. Semantics follow the tone: `danger` uses `role="alert"` (assertive),
 * every other tone uses `role="status"` (polite). The two roles are never
 * combined.
 *
 * The component is server-renderable. `dismissible` is intentionally not
 * supported here — a dismissible variant needs client state and belongs in a
 * separate primitive.
 *
 * @param props.tone - Visual tone; defaults to `"info"`.
 * @param props.title - Optional bold heading rendered above the message.
 * @param props.icon - Optional decorative glyph; defaults per tone. Always `aria-hidden`.
 * @param props.action - Optional slot rendered to the right of the message.
 * @param props.className - Optional extra classes merged onto the root element.
 * @param props.children - The message body; carries all meaning for assistive tech.
 */
export function Alert({
  tone = "info",
  title,
  icon,
  action,
  className,
  children,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const role = tone === "danger" ? "alert" : "status";

  return (
    <div
      role={role}
      className={[
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        TONE_CLASSES[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true" className={["mt-0.5 shrink-0", TONE_ICON_CLASSES[tone]].join(" ")}>
        {icon ?? DEFAULT_ICONS[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={title ? "mt-0.5 text-pm-muted" : undefined}>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
