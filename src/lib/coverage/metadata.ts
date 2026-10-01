/**
 * Shared coverage metadata.
 *
 * Category accent colours live here as CSS custom-property names so they can be
 * theme-swapped from `src/app/globals.css` instead of being hard-coded as hex or
 * rgba literals inside JSX. Consumers set the variable on an element, e.g.
 *
 *   style={{ "--accent": accentVar(type.accent) } as React.CSSProperties}
 *
 * and then reference it from Tailwind arbitrary values (`bg-[var(--accent)]`).
 *
 * Canvas consumers (which need resolved colour strings rather than CSS
 * variables) should read the computed value at runtime:
 *
 *   getComputedStyle(el).getPropertyValue(accentVar(type.accent)).trim()
 */

/** Accent token names available to coverage categories. */
export type AccentToken =
  | "--accent-violet"
  | "--accent-blue"
  | "--accent-emerald"
  | "--accent-amber"
  | "--accent-rose";

/** A single coverage category and the accent token that themes it. */
export interface CoverageType {
  /** Stable identifier used for keys and lookups. */
  id: string;
  /** Human readable label. */
  label: string;
  /** CSS custom property that carries this category's accent colour. */
  accent: AccentToken;
}

/**
 * Resolve an accent token to a `var(...)` reference suitable for inline styles
 * or Tailwind arbitrary values.
 */
export function accentVar(token: AccentToken): string {
  return `var(${token})`;
}

/**
 * Resolve an accent token to a translucent background reference. The alpha is
 * applied via `color-mix` so the underlying colour stays theme-swappable.
 */
export function accentSoft(token: AccentToken, alpha = 15): string {
  return `color-mix(in srgb, var(${token}) ${alpha}%, transparent)`;
}

/** Canonical coverage categories, each backed by a shared accent token. */
export const COVERAGE_TYPES: CoverageType[] = [
  { id: "violet", label: "Violet", accent: "--accent-violet" },
  { id: "blue", label: "Blue", accent: "--accent-blue" },
  { id: "emerald", label: "Emerald", accent: "--accent-emerald" },
  { id: "amber", label: "Amber", accent: "--accent-amber" },
  { id: "rose", label: "Rose", accent: "--accent-rose" },
];

/** Look up a coverage category by id. */
export function getCoverageType(id: string): CoverageType | undefined {
  return COVERAGE_TYPES.find((type) => type.id === id);
}
