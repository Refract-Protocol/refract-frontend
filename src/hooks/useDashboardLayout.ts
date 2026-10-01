"use client";

import { useCallback, useEffect, useState } from "react";

export type DashboardSectionId = "summary" | "policies" | "claims";

export interface DashboardSectionLayout {
  id: DashboardSectionId;
  hidden: boolean;
}

/**
 * Default order for first-time and disconnected users: Summary stats first
 * (foundational — it can't be hidden), then Policies, then Claims history.
 */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardSectionLayout[] = [
  { id: "summary", hidden: false },
  { id: "policies", hidden: false },
  { id: "claims", hidden: false },
];

/** Sections that can't be hidden. */
export const UNHIDEABLE_SECTIONS: readonly DashboardSectionId[] = ["summary"];

const LAYOUT_VERSION = 1;
const storageKey = (address: string) => `refract:dashboard-layout:${address}`;

/**
 * Validates a stored layout. Anything from an older/newer schema version, or
 * that doesn't cover exactly the known sections, falls back to the default.
 */
export function parseStoredLayout(raw: string | null): DashboardSectionLayout[] {
  if (!raw) return DEFAULT_DASHBOARD_LAYOUT;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; sections?: unknown };
    if (parsed.version !== LAYOUT_VERSION || !Array.isArray(parsed.sections)) return DEFAULT_DASHBOARD_LAYOUT;
    const known = new Set(DEFAULT_DASHBOARD_LAYOUT.map((s) => s.id));
    const sections = parsed.sections.filter(
      (s): s is DashboardSectionLayout =>
        typeof s === "object" && s !== null && known.has(s.id) && typeof s.hidden === "boolean"
    );
    if (sections.length !== known.size || new Set(sections.map((s) => s.id)).size !== known.size) {
      return DEFAULT_DASHBOARD_LAYOUT;
    }
    return sections.map((s) => ({ id: s.id, hidden: UNHIDEABLE_SECTIONS.includes(s.id) ? false : s.hidden }));
  } catch {
    return DEFAULT_DASHBOARD_LAYOUT;
  }
}

/**
 * Per-wallet Dashboard section order + visibility, persisted to localStorage.
 * Degrades to the default (non-persisted) layout when there's no connected
 * address or storage is unavailable (e.g. private browsing).
 */
export function useDashboardLayout(address: string | null) {
  const [layout, setLayout] = useState<DashboardSectionLayout[]>(DEFAULT_DASHBOARD_LAYOUT);

  useEffect(() => {
    if (!address) {
      setLayout(DEFAULT_DASHBOARD_LAYOUT);
      return;
    }
    try {
      setLayout(parseStoredLayout(window.localStorage.getItem(storageKey(address))));
    } catch {
      setLayout(DEFAULT_DASHBOARD_LAYOUT);
    }
  }, [address]);

  const update = useCallback(
    (next: (prev: DashboardSectionLayout[]) => DashboardSectionLayout[]) => {
      setLayout((prev) => {
        const value = next(prev);
        if (address) {
          try {
            window.localStorage.setItem(storageKey(address), JSON.stringify({ version: LAYOUT_VERSION, sections: value }));
          } catch {
            // Storage unavailable — keep the in-memory layout only.
          }
        }
        return value;
      });
    },
    [address]
  );

  /** Moves the section at `from` to index `to`. */
  const move = useCallback(
    (from: number, to: number) =>
      update((prev) => {
        if (to < 0 || to >= prev.length || from === to) return prev;
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
      }),
    [update]
  );

  const toggleHidden = useCallback(
    (id: DashboardSectionId) =>
      update((prev) =>
        UNHIDEABLE_SECTIONS.includes(id) ? prev : prev.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s))
      ),
    [update]
  );

  const reset = useCallback(() => update(() => DEFAULT_DASHBOARD_LAYOUT), [update]);

  return { layout, move, toggleHidden, reset };
}
