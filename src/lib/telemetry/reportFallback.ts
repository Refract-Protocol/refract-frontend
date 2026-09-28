import { track } from "@/lib/analytics/track";

/**
 * Reports that a hook fell back to fixture data, so a real backend outage is
 * observable instead of silently masked. Deduplicated per hook: at most one
 * report per `FALLBACK_REPORT_WINDOW_MS`, so a sustained outage doesn't emit
 * an event on every mount. Interim sink is `console.error` + an analytics
 * event until a dedicated error-tracking service (e.g. Sentry) is wired in.
 */
export const FALLBACK_REPORT_WINDOW_MS = 5 * 60 * 1000;

const lastReported = new Map<string, number>();

export function reportFallback(hookName: string, error: unknown, now: number = Date.now()): void {
  try {
    const last = lastReported.get(hookName);
    if (last !== undefined && now - last < FALLBACK_REPORT_WINDOW_MS) return;
    lastReported.set(hookName, now);

    const errorName = error instanceof Error ? error.name : typeof error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[telemetry] ${hookName} fell back to fixture data`, { errorName, errorMessage });
    track("api_fallback", { hook: hookName, errorName, errorMessage });
  } catch {
    // Deliberately silent: telemetry must never block fixture fallback rendering.
  }
}

/** Test helper: clears the per-hook rate-limit state. */
export function resetFallbackReports(): void {
  lastReported.clear();
}
