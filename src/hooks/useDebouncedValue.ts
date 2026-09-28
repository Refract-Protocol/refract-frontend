"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` only after it has stopped changing for `delayMs`. Use this
 * for anything that reacts to user input with a network call (quotes, fee
 * estimates, simulations) so it isn't fired on every keystroke. Pending
 * timers are cleared on each change and on unmount, so a stale value can
 * never land after a newer one.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
