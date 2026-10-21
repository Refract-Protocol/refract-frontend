import type { RealtimeClock } from "./clock";

/** Use after `vi.useFakeTimers()`; every client timer then advances with Vitest. */
export const fakeRealtimeClock: RealtimeClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle),
  setInterval: (callback, interval) => setInterval(callback, interval),
  clearInterval: (handle) => clearInterval(handle),
};
