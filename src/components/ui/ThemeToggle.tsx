"use client";

import { useTheme } from "@/lib/theme/ThemeProvider";

/**
 * Accessible control that cycles the active theme between light and dark.
 *
 * The accessible name reflects the action that will be performed (e.g.
 * "Switch to light theme") so screen-reader users know what to expect.
 * When the resolved theme is dark the button offers to switch to light and
 * vice versa.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  const isDark = resolvedTheme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  const label = `Switch to ${nextTheme} theme`;

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--pm-border)] bg-[var(--pm-surface)] text-[var(--pm-text)] transition-colors hover:bg-[var(--pm-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent)]"
    >
      <span aria-hidden="true">{isDark ? "\u2600\uFE0F" : "\uD83C\uDF19"}</span>
    </button>
  );
}
