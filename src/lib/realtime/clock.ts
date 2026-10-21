export type TimerHandle = ReturnType<typeof setTimeout>;

/** Time source used by realtime lifecycle code. Tests can advance its timers deterministically. */
export interface RealtimeClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, intervalMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

export const realRealtimeClock: RealtimeClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle),
  setInterval: (callback, interval) => setInterval(callback, interval),
  clearInterval: (handle) => clearInterval(handle),
};
