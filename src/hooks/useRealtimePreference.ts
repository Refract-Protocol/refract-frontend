"use client";

/**
 * useRealtimePreference — reactive hook that tracks all three signals
 * (user preference, save-data, battery) and returns the effective decision.
 *
 * The hook is consumed by RealtimeModeGuard, which calls client.setEnabled()
 * whenever the decision changes. No component independently decides to connect.
 */

import { useEffect, useState } from 'react';
import { usePreferencesStore } from '@/lib/store/preferencesStore';
import {
  shouldUseRealtime,
  readSaveData,
  getBattery,
  isBatteryLow,
  type RealtimeDecision,
  type BatteryManager,
} from '@/lib/realtime/realtimeUserPreference';

export type { RealtimeDecision };

export function useRealtimePreference(): RealtimeDecision {
  const liveUpdates = usePreferencesStore((s) => s.liveUpdates);
  const [saveData, setSaveData] = useState(false);
  const [batteryLow, setBatteryLow] = useState(false);

  // Save-Data: read once on mount, then watch for media-query changes.
  useEffect(() => {
    setSaveData(readSaveData());

    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-reduced-data: reduce)');
      const handler = () => setSaveData(readSaveData());
      mq.addEventListener('change', handler);
      return () => mq!.removeEventListener('change', handler);
    } catch {
      return undefined;
    }
  }, []);

  // Battery API: async feature-detect, then subscribe to level/charging events.
  useEffect(() => {
    let battery: BatteryManager | null = null;
    let cancelled = false;

    const update = () => {
      if (!cancelled) setBatteryLow(isBatteryLow(battery));
    };

    getBattery().then((b) => {
      if (cancelled || !b) return;
      battery = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    });

    return () => {
      cancelled = true;
      if (battery) {
        battery.removeEventListener('levelchange', update);
        battery.removeEventListener('chargingchange', update);
      }
    };
  }, []);

  // SSR guard: on the server return neutral state.
  if (typeof window === 'undefined') {
    return { use: false, reason: 'ssr' };
  }

  return shouldUseRealtime({ liveUpdates, saveData, batteryLow });
}
