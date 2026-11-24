import { describe, expect, it } from 'vitest';

import { api, config, realtime } from './config';

describe('config', () => {
  it('freezes the realtime config', () => {
    expect(Object.isFrozen(config.realtime)).toBe(true);
    expect(Object.isFrozen(realtime)).toBe(true);
  });

  it('deeply freezes nested config objects', () => {
    expect(Object.isFrozen(realtime.reconnect)).toBe(true);
    expect(Object.isFrozen(realtime.heartbeat)).toBe(true);
  });

  it('freezes the api and aggregate config', () => {
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('throws when attempting to mutate a frozen config object', () => {
    expect(() => {
      (realtime as { timeout: number }).timeout = 0;
    }).toThrow();
  });
});
