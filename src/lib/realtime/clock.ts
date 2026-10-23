import { realtimeClient } from "./client";

/** Topic payload: `{ now }` on each tick; `boundary: true` marks a window start/expiry crossing. */
export const CLOCK_TOPIC = "clock";

let offsetMs: number | null = null;
const tickers = new Map<number, { id: ReturnType<typeof setInterval>; fns: Set<() => void> }>();
const boundaryListeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

/** Server-authoritative "now"; null until a server tick has been received. */
export function serverNow(): number | null {
  return offsetMs === null ? null : Date.now() + offsetMs;
}

/** Best available "now": server time once synced, otherwise the client clock. */
export function now(): number {
  return Date.now() + (offsetMs ?? 0);
}

export function isClockSynced(): boolean {
  return offsetMs !== null;
}

function onClockMessage(payload: unknown): void {
  const p = payload as { now?: number; boundary?: boolean } | null;
  if (typeof p?.now !== "number") return;
  offsetMs = p.now - Date.now();
  if (p.boundary) {
    boundaryListeners.forEach((l) => l());
    tickers.forEach((t) => t.fns.forEach((fn) => fn()));
  }
}

function ensureSubscribed(): void {
  if (!unsubscribe) unsubscribe = realtimeClient.subscribe(CLOCK_TOPIC, onClockMessage);
}

/** One interval per cadence, shared by every consumer. Returns an unsubscribe function. */
export function subscribeTick(fn: () => void, intervalMs: number): () => void {
  ensureSubscribed();
  let t = tickers.get(intervalMs);
  if (!t) {
    const fns = new Set<() => void>();
    t = { id: setInterval(() => fns.forEach((f) => f()), intervalMs), fns };
    tickers.set(intervalMs, t);
  }
  t.fns.add(fn);
  return () => {
    const cur = tickers.get(intervalMs);
    if (!cur) return;
    cur.fns.delete(fn);
    if (cur.fns.size === 0) {
      clearInterval(cur.id);
      tickers.delete(intervalMs);
    }
  };
}

export function _resetClockForTests(): void {
  offsetMs = null;
  tickers.forEach((t) => clearInterval(t.id));
  tickers.clear();
  boundaryListeners.clear();
  unsubscribe?.();
  unsubscribe = null;
}
