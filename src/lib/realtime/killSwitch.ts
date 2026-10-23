"use client";

export type KillSwitchSource = "remote" | "manual" | "auto";
export type KillSwitchState = { disabled: boolean; source: KillSwitchSource | null };
const POLL_MS = 5_000;
const TIMEOUT_MS = 3_000;
const listeners = new Set<(state: KillSwitchState) => void>();
let state: KillSwitchState = { disabled: false, source: null };
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let inflight: Promise<void> | null = null;

function setState(next: KillSwitchState) {
  if (state.disabled === next.disabled && state.source === next.source) return;
  state = next;
  listeners.forEach((listener) => listener(state));
  if (next.disabled && typeof console !== "undefined")
    console.error(`[realtime] disabled (${next.source})`);
}

export function isRealtimeDisabled(): boolean {
  return state.disabled;
}
export function getKillSwitchState(): KillSwitchState {
  return state;
}
export function subscribeKillSwitch(listener: (state: KillSwitchState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function tripKillSwitch(source: KillSwitchSource = "manual"): void {
  setState({ disabled: true, source });
}

/** Unknown or unavailable remote values preserve the current safe state. */
export function applyRemoteKillSwitchConfiguration(config: unknown): void {
  if (
    typeof config === "object" &&
    config !== null &&
    "disabled" in config &&
    config.disabled === true
  ) {
    setState({ disabled: true, source: "remote" });
  }
}

export async function checkRemoteKillSwitch(): Promise<void> {
  if (typeof fetch === "undefined") return;
  if (inflight) return inflight;
  inflight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch("/realtime-control.json", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) {
        applyRemoteKillSwitchConfiguration(await response.json());
        // Remote configuration can trip but never clear a local or remote trip.
      }
    } catch {
      /* Keep the last known state; boot and REST remain available. */
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function startKillSwitchPolling(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (!started) {
    started = true;
    const tick = () => {
      void checkRemoteKillSwitch().finally(() => {
        timer = setTimeout(tick, POLL_MS);
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkRemoteKillSwitch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void checkRemoteKillSwitch().finally(() => {
      timer = setTimeout(tick, POLL_MS);
    });
  }
  return () => undefined;
}
