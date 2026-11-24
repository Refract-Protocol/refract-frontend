/**
 * Application configuration.
 *
 * All exported config objects are deeply frozen at module load time so that
 * accidental mutation (e.g. `config.realtime.timeout = 0`) throws in strict
 * mode instead of silently changing shared state for the whole app.
 */

/**
 * Recursively freezes an object and all of its nested plain-object/array
 * properties. Returns the same reference for convenient inline use.
 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child && typeof child === 'object') {
        deepFreeze(child);
      }
    }
  }
  return value;
}

/** Frozen: immutable realtime transport configuration. */
export const realtime = deepFreeze({
  timeout: 30_000,
  reconnect: {
    maxAttempts: 5,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
  },
  heartbeat: {
    intervalMs: 15_000,
  },
});

/** Frozen: immutable API client configuration. */
export const api = deepFreeze({
  baseUrl: '/api',
  timeout: 30_000,
  retries: 3,
});

/** Frozen: immutable aggregate config object. */
export const config = deepFreeze({
  realtime,
  api,
});

export type AppConfig = typeof config;
