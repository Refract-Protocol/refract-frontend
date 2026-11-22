"use client";

/**
 * RealtimeModeGuard — the single initialization boundary for the realtime
 * transport.
 *
 * Reads the effective decision from useRealtimePreference and calls
 * client.setEnabled() whenever it changes. This is the only place that
 * makes the connect/disconnect decision — no hook or component does it
 * independently.
 *
 * Mount order: must be a child of the preferences store hydration boundary
 * (i.e. inside Providers) but above any hook that calls client.subscribe().
 */

import { useEffect } from 'react';
import { realtimeClient } from '@/lib/realtime/client';
import { useRealtimePreference } from '@/hooks/useRealtimePreference';

export function RealtimeModeGuard({ children }: { children: React.ReactNode }) {
  const decision = useRealtimePreference();

  useEffect(() => {
    realtimeClient.setEnabled(decision.use);
  }, [decision.use]);

  return <>{children}</>;
}
