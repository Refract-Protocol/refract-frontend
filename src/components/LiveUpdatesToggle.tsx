"use client";

/**
 * LiveUpdatesToggle — explicit user control for the realtime layer.
 *
 * Shows:
 * - A toggle switch ("Live updates: on/off") wired to the persisted preference.
 * - A one-line explanation when the app has auto-downgraded due to Save-Data
 *   or battery-saver, even if the user preference is 'on'.
 * - A "diagnostics" line showing the effective mode for support contexts.
 */

import { usePreferencesStore } from '@/lib/store/preferencesStore';
import { useRealtimePreference } from '@/hooks/useRealtimePreference';
import { DOWNGRADE_REASON_LABEL } from '@/lib/realtime/realtimeUserPreference';

export function LiveUpdatesToggle() {
  const liveUpdates = usePreferencesStore((s) => s.liveUpdates);
  const setLiveUpdates = usePreferencesStore((s) => s.setLiveUpdates);
  const decision = useRealtimePreference();

  const isOn = liveUpdates === 'on';
  const autoDowngraded =
    isOn && decision.reason !== null && decision.reason !== 'preference' && decision.reason !== 'ssr';
  const downgradeLabel =
    autoDowngraded && decision.reason && decision.reason in DOWNGRADE_REASON_LABEL
      ? DOWNGRADE_REASON_LABEL[decision.reason as keyof typeof DOWNGRADE_REASON_LABEL]
      : null;

  return (
    <div className="flex flex-col gap-2">
      {/* Toggle row */}
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="text-sm font-medium text-pm-text">Live updates</span>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          onClick={() => setLiveUpdates(isOn ? 'off' : 'on')}
          className={[
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
            'transition-colors duration-200 ease-in-out focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-pm-violet focus-visible:ring-offset-2',
            isOn ? 'bg-pm-violet' : 'bg-pm-text/20',
          ].join(' ')}
        >
          <span className="sr-only">{isOn ? 'Disable live updates' : 'Enable live updates'}</span>
          <span
            aria-hidden="true"
            className={[
              'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0',
              'transition duration-200 ease-in-out',
              isOn ? 'translate-x-4' : 'translate-x-0',
            ].join(' ')}
          />
        </button>
      </label>

      {/* Auto-downgrade notice */}
      {downgradeLabel && (
        <p role="status" className="text-xs text-pm-amber">
          {downgradeLabel}
        </p>
      )}

      {/* Diagnostics line */}
      <p className="text-[11px] text-pm-text/40">
        Effective mode:{' '}
        <span data-testid="realtime-effective-mode">
          {decision.use ? 'realtime' : `REST only${decision.reason ? ` (${decision.reason})` : ''}`}
        </span>
      </p>
    </div>
  );
}
