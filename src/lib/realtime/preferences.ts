export const REALTIME_OPT_OUT_KEY = "refract_realtime_opt_out";

export function isRealtimeOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(REALTIME_OPT_OUT_KEY) === "true";
  } catch {
    return false;
  }
}

export function isRealtimeAllowed(): boolean {
  if (typeof window === "undefined" || isRealtimeOptedOut()) return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return (
    connection?.saveData !== true && !window.matchMedia?.("(prefers-reduced-data: reduce)").matches
  );
}

/** Persist the user's choice for the next app-shell lifecycle. */
export function setRealtimeOptOut(optOut: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (optOut) window.localStorage.setItem(REALTIME_OPT_OUT_KEY, "true");
    else window.localStorage.removeItem(REALTIME_OPT_OUT_KEY);
  } catch {
    // Storage can be unavailable in private browsing; the current session remains usable.
  }
  window.dispatchEvent(new Event("refract-realtime-preference-change"));
}
