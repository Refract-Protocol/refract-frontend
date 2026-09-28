/**
 * Pluggable client-side analytics. Call sites use `track(event, props)`; the
 * actual backend (PostHog, Plausible, a custom endpoint…) is swapped in via
 * `setAnalyticsProvider` without touching them. Defaults to a console provider
 * in development and a no-op in production until a real vendor is wired up.
 *
 * PRIVACY: never pass PII. The only user identifier allowed in `props` is the
 * public Stellar wallet address (already public on-chain) — no emails, names,
 * IPs or free-form user input.
 *
 * Do Not Track: if the browser reports `navigator.doNotTrack === "1"` (or
 * `globalPrivacyControl`), events are dropped before reaching any provider.
 */
export type AnalyticsEvent =
  | "wallet_connect_clicked"
  | "wallet_connected"
  | "coverage_type_selected"
  | "quote_viewed"
  | "buy_initiated"
  | "buy_confirmed"
  | "buy_failed"
  | "deposit_initiated"
  | "deposit_confirmed"
  | "withdraw_initiated"
  | "withdraw_confirmed"
  | "api_fallback";

export type AnalyticsProps = Record<string, unknown>;

export interface AnalyticsProvider {
  track(event: AnalyticsEvent, props?: AnalyticsProps): void | Promise<void>;
}

export const noopProvider: AnalyticsProvider = { track() {} };

export const consoleProvider: AnalyticsProvider = {
  track(event, props) {
    console.info("[analytics]", event, props ?? {});
  },
};

let provider: AnalyticsProvider = process.env.NODE_ENV === "development" ? consoleProvider : noopProvider;

export function setAnalyticsProvider(next: AnalyticsProvider): void {
  provider = next;
}

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/** Fire-and-forget: never throws and never blocks the UI. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  try {
    if (doNotTrack()) return;
    const result = provider.track(event, props);
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // Analytics must never break the app.
  }
}
