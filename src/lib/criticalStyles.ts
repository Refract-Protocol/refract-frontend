/**
 * Critical design tokens for the root error boundary.
 *
 * `src/app/global-error.tsx` replaces the entire document tree when the root
 * layout throws, so it cannot rely on `globals.css` being loaded or on the
 * `components/ui` primitives. These values mirror the token subset defined in
 * `globals.css` and exist here so the hex literals live in exactly one place.
 *
 * Keep in sync with `globals.css` (the token-check script asserts against it).
 */
export interface CriticalTokens {
  /** Page background (`--pm-bg`). */
  bg: string;
  /** Primary foreground text (`--pm-text`). */
  text: string;
  /** Brand accent (`--pm-purple`). */
  accent: string;
  /** Error/danger accent (`--pm-red`). */
  danger: string;
  /** Panel surface (`--pm-surface`). */
  surface: string;
  /** Panel border (`--pm-border`). */
  border: string;
  /** Brand display font stack. */
  fontDisplay: string;
  /** Body font stack. */
  fontBody: string;
  /** Monospace stack for the digest reference. */
  fontMono: string;
}

/**
 * The minimum token subset required to render the root error boundary on-brand
 * with zero CSS files loaded and with JavaScript hydration failing.
 */
export const criticalTokens: CriticalTokens = {
  bg: "#07050f",
  text: "#ede9f8",
  accent: "#8b5cf6",
  danger: "#ef4444",
  surface: "#0f0b1c",
  border: "#241b3d",
  fontDisplay:
    "'Space Grotesk', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontBody:
    "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontMono:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};
