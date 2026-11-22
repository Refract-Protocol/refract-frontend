/**
 * Stories for PoolActivityFeed.
 *
 * The feed is driven by realtime events (pool_activity, pool_presence).
 * Each story injects canned events via the mock client so no backend is needed.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { useEffect } from 'react';
import { PoolActivityFeed } from './PoolActivityFeed';
import {
  withMockRealtime,
  mockRealtimeClient,
  setMockHealth,
} from '@/lib/realtime/testing/mockRealtimeDecorator';
import type { PoolActivityEvent } from '@/lib/realtime/topics';

const meta: Meta<typeof PoolActivityFeed> = {
  title: 'Realtime/PoolActivityFeed',
  component: PoolActivityFeed,
  decorators: [withMockRealtime],
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof PoolActivityFeed>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();

const FEED_EVENTS: PoolActivityEvent[] = [
  { id: 'e1', kind: 'deposit', at: NOW - 10_000, sizeBucket: 'large' },
  { id: 'e2', kind: 'coverage_written', at: NOW - 25_000 },
  { id: 'e3', kind: 'withdraw', at: NOW - 60_000, sizeBucket: 'medium' },
  { id: 'e4', kind: 'deposit', at: NOW - 90_000, sizeBucket: 'small' },
  { id: 'e5', kind: 'coverage_written', at: NOW - 120_000 },
];

function pushFeedEvents() {
  for (const event of FEED_EVENTS) {
    mockRealtimeClient.publish('pool_activity', event, 'mock');
  }
  mockRealtimeClient.publish('pool_presence', { active: 7 }, 'mock');
}

// ---------------------------------------------------------------------------
// Connected — feed populated with activity.
// ---------------------------------------------------------------------------
export const Connected: Story = {
  render: () => {
    useEffect(() => {
      setMockHealth('healthy');
      pushFeedEvents();
    }, []);
    return <PoolActivityFeed />;
  },
};

// ---------------------------------------------------------------------------
// Empty — no activity yet.
// ---------------------------------------------------------------------------
export const Empty: Story = {
  render: () => {
    useEffect(() => {
      setMockHealth('healthy');
    }, []);
    return <PoolActivityFeed />;
  },
};

// ---------------------------------------------------------------------------
// Connecting — stream not yet established.
// ---------------------------------------------------------------------------
export const Connecting: Story = {
  render: () => {
    useEffect(() => {
      setMockHealth('degraded');
    }, []);
    return <PoolActivityFeed />;
  },
};

// ---------------------------------------------------------------------------
// Degraded — has cached data but stream is degraded.
// ---------------------------------------------------------------------------
export const Degraded: Story = {
  render: () => {
    useEffect(() => {
      pushFeedEvents();
      setMockHealth('degraded');
    }, []);
    return <PoolActivityFeed />;
  },
};

// ---------------------------------------------------------------------------
// Offline / unavailable — health is fully unavailable.
// ---------------------------------------------------------------------------
export const Offline: Story = {
  render: () => {
    useEffect(() => {
      pushFeedEvents();
      setMockHealth('unavailable');
    }, []);
    return <PoolActivityFeed />;
  },
};

// ---------------------------------------------------------------------------
// Presence unavailable — activity without presence data.
// ---------------------------------------------------------------------------
export const NoPresence: Story = {
  render: () => {
    useEffect(() => {
      setMockHealth('healthy');
      for (const event of FEED_EVENTS) {
        mockRealtimeClient.publish('pool_activity', event, 'mock');
      }
      // No pool_presence push → presence stays null.
    }, []);
    return <PoolActivityFeed />;
  },
};

// ---------------------------------------------------------------------------
// Live stream — events arrive one-by-one over time (interactive demo).
// ---------------------------------------------------------------------------
export const LiveStream: Story = {
  render: () => {
    useEffect(() => {
      setMockHealth('healthy');
      mockRealtimeClient.publish('pool_presence', { active: 3 }, 'mock');
      let i = 0;
      const id = setInterval(() => {
        if (i >= FEED_EVENTS.length) {
          clearInterval(id);
          return;
        }
        mockRealtimeClient.publish('pool_activity', FEED_EVENTS[i]!, 'mock');
        i++;
      }, 600);
      return () => clearInterval(id);
    }, []);
    return <PoolActivityFeed />;
  },
  parameters: {
    chromatic: { delay: 4000, pauseAnimationAtEnd: true },
  },
};
