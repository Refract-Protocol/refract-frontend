/**
 * Storybook decorator and helpers that replace the live realtimeClient with
 * a fully isolated, deterministic mock. Import from this file in *.stories.tsx
 * only — it must never reach the production bundle.
 *
 * Usage:
 *   import { withMockRealtime, mockRealtimeClient } from '@/lib/realtime/testing/mockRealtimeDecorator';
 *
 *   export default {
 *     decorators: [withMockRealtime],
 *   };
 *
 *   // Push a canned event in a story:
 *   mockRealtimeClient.publish('oracle_update', ORACLE_FIXTURE);
 */

import React, { useEffect, type Decorator } from 'react';
import { RealtimeClient } from '../client';
import type { RealtimeHealth } from '../health';

// ---------------------------------------------------------------------------
// Singleton mock client used across all stories in a Storybook session.
// It never opens a real socket (createSocket: null).
// ---------------------------------------------------------------------------
export const mockRealtimeClient = new RealtimeClient({
  createSocket: null,
  url: () => 'ws://mock/ws',
});

// ---------------------------------------------------------------------------
// withMockRealtime decorator
// Wraps any story to suppress real network activity and provide a stable
// mock client. Clears cached state between stories to avoid cross-story leaks.
// ---------------------------------------------------------------------------
export const withMockRealtime: Decorator = (Story) => {
  // Clear between renders so each story starts clean.
  useEffect(() => {
    mockRealtimeClient.clearCache();
    mockRealtimeClient.disconnect();
  }, []);

  return <Story />;
};

// ---------------------------------------------------------------------------
// Helpers for injecting health states into stories
// ---------------------------------------------------------------------------

/** Set the connection health on the mock client's health store. */
export function setMockHealth(health: RealtimeHealth): void {
  mockRealtimeClient.health.setConnection(health);
}

/** Push a canned realtime frame synchronously. */
export function pushMockFrame(topic: string, payload: unknown): void {
  mockRealtimeClient.publish(topic, payload, 'mock');
}
