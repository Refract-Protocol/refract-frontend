/**
 * shouldUseRealtime — the single decision point for whether the realtime
 * transport should connect.
 *
 * The effective mode is the product of three independent signals:
 *   1. User preference  — explicit "Live updates: on/off" persisted in the
 *      preferencesStore (defaults to 'on').
 *   2. Save-Data        — navigator.connection.saveData or
 *      prefers-reduced-data media query (browser opt-in for metered data).
 *   3. Battery saver    — Battery Status API: low-charge + discharging.
 *
 * All three must allow realtime for the transport to connect.
 * When any signal forces it off, the reason is recorded so the UI can
 * explain the downgrade to the user.
 *
 * SSR note: all browser API calls are guarded so this module is safe on the
 * server — it returns `{ use: false, reason: 'ssr' }` when window is undefined.
 */

export type RealtimeOffReason =
  | 'preference'   // user explicitly turned it off
  | 'save-data'    // navigator.connection.saveData or prefers-reduced-data
  | 'battery'      // low + discharging battery
  | 'ssr'          // server-side render, no browser APIs available
  | null;          // no reason — realtime is on

export interface RealtimeDecision {
  /** Whether the transport should be active. */
  use: boolean;
  /** Why it is off, or null when on. */
  reason: RealtimeOffReason;
}

export interface RealtimeDecisionInputs {
  /** From preferencesStore: 'on' | 'off'. */
  liveUpdates: 'on' | 'off';
  /** navigator.connection?.saveData or prefers-reduced-data. */
  saveData: boolean;
  /** Battery API: level <= threshold AND discharging. */
  batteryLow: boolean;
}

/** Battery level at or below which we auto-downgrade (20%). */
export const BATTERY_LOW_THRESHOLD = 0.20;

/**
 * Pure selector — no side effects, fully unit-testable.
 * Returns the realtime decision for a given set of inputs.
 */
export function shouldUseRealtime(inputs: RealtimeDecisionInputs): RealtimeDecision {
  if (inputs.liveUpdates === 'off') return { use: false, reason: 'preference' };
  if (inputs.saveData) return { use: false, reason: 'save-data' };
  if (inputs.batteryLow) return { use: false, reason: 'battery' };
  return { use: true, reason: null };
}

/** Human-readable explanation for the auto-downgrade banner. */
export const DOWNGRADE_REASON_LABEL: Record<Exclude<RealtimeOffReason, null | 'preference' | 'ssr'>, string> = {
  'save-data': 'Live updates paused — your browser has data-saving enabled.',
  'battery': 'Live updates paused — battery saver is active.',
};

// ---------------------------------------------------------------------------
// Browser capability detection (non-reactive, called once at mount)
// ---------------------------------------------------------------------------

/** Read save-data from navigator.connection or the media query. */
export function readSaveData(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
  };
  if (nav.connection?.saveData === true) return true;
  try {
    return window.matchMedia('(prefers-reduced-data: reduce)').matches;
  } catch {
    return false;
  }
}

export interface BatteryManager {
  level: number;
  charging: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Feature-detect and return the BatteryManager, or null if unsupported. */
export async function getBattery(): Promise<BatteryManager | null> {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
  if (typeof nav.getBattery !== 'function') return null;
  try {
    return await nav.getBattery();
  } catch {
    return null;
  }
}

/** True when the battery is low and discharging. */
export function isBatteryLow(battery: BatteryManager | null): boolean {
  if (!battery) return false;
  return !battery.charging && battery.level <= BATTERY_LOW_THRESHOLD;
}
