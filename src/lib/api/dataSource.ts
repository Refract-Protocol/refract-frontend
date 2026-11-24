/**
 * Data source entry point for the API layer.
 *
 * This module switches between live and fixture data. The return shape of
 * every function exported here is identical in both modes, so callers can
 * treat the results the same way regardless of which mode is active.
 *
 * Fixture mode is selected by the `NEXT_PUBLIC_DATA_SOURCE` environment
 * variable (set it to `'fixture'`). Callers must not branch on the mode;
 * use {@link getDataSource} only for logging/diagnostics.
 */

export type DataSource = 'live' | 'fixture';

/**
 * Returns the currently active data source mode.
 *
 * Intended for logging/diagnostics only — callers must not branch on the
 * mode, since the return shape is identical in both modes.
 */
export function getDataSource(): DataSource {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === 'fixture' ? 'fixture' : 'live';
}
