import { useMemo } from 'react';
import { flagsConfig, DEFAULT_FLAG_VALUE } from '../lib/flags/flagsConfig';

/**
 * Resolve a feature flag value.
 *
 * Known flags are resolved from the flags config exactly as before.
 * Unknown flags fall back to the documented boolean default exported by
 * `flagsConfig` so consumers always receive a `boolean`.
 */
export function useFeatureFlag(flagName: string): boolean {
  return useMemo(() => {
    const value = flagsConfig[flagName];
    if (typeof value === 'boolean') {
      return value;
    }
    return DEFAULT_FLAG_VALUE;
  }, [flagName]);
}

export default useFeatureFlag;
