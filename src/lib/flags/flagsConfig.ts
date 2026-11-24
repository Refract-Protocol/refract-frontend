import flagsJson from '../../../public/flags.json';

/**
 * Value returned for any flag that is not declared in `public/flags.json`.
 *
 * Unknown flags resolve to `false` so callers always receive a boolean and
 * `if (useFeatureFlag('x'))` behaves predictably instead of silently taking
 * the false branch on `undefined`.
 */
export const DEFAULT_FLAG_VALUE = false;

type FlagsConfig = typeof flagsJson;

/**
 * Resolve a feature flag to a boolean.
 *
 * Declared flags in `public/flags.json` are read from the `flags` map; any
 * key that is not declared (or whose value is not a boolean) resolves to
 * {@link DEFAULT_FLAG_VALUE} (`false`). This function never returns
 * `undefined`, so the result is safe to use directly in conditionals.
 */
export function resolveFlag(name: string): boolean {
  const flags = (flagsJson as FlagsConfig).flags as Record<string, unknown>;
  const value = flags?.[name];
  return typeof value === 'boolean' ? value : DEFAULT_FLAG_VALUE;
}

export default flagsJson;
