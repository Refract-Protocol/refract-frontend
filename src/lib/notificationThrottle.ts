export type ThrottledFn<TArgs extends unknown[]> = ((...args: TArgs) => void) & {
  cancel: () => void;
  flush: () => void;
};

/**
 * Leading + trailing throttle.
 *
 * The first call within a window fires immediately (leading edge). Any calls
 * that arrive during the window are coalesced and only the latest payload is
 * delivered when the window closes (trailing edge). This guarantees the final
 * notification in a burst is never dropped while keeping the maximum call rate
 * bounded to one call per `wait` ms.
 */
export function notificationThrottle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number
): ThrottledFn<TArgs> {
  let lastCallTime = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: TArgs | null = null;

  const invoke = (args: TArgs) => {
    lastCallTime = Date.now();
    fn(...args);
  };

  const throttled = ((...args: TArgs) => {
    const now = Date.now();
    const remaining = wait - (now - lastCallTime);

    if (remaining <= 0 || remaining > wait) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingArgs = null;
      invoke(args);
      return;
    }

    // Within the window: remember only the latest payload for the trailing call.
    pendingArgs = args;
    if (timer) return;

    timer = setTimeout(() => {
      timer = null;
      const argsToFlush = pendingArgs;
      pendingArgs = null;
      if (argsToFlush) invoke(argsToFlush);
    }, remaining);
  }) as ThrottledFn<TArgs>;

  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };

  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const argsToFlush = pendingArgs;
    pendingArgs = null;
    if (argsToFlush) invoke(argsToFlush);
  };

  return throttled;
}
