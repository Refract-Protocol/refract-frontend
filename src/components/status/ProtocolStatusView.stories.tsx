/**
 * Stories for ProtocolStatusView.
 *
 * Every story is driven by a canned mock — no live network required.
 * The mock realtime client is injected via the withMockRealtime decorator so
 * states are deterministic across CI snapshot runs.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { useEffect } from 'react';
import { ProtocolStatusView } from './ProtocolStatusView';
import { withMockRealtime, mockRealtimeClient } from '@/lib/realtime/testing/mockRealtimeDecorator';
import type { ProtocolStatus } from '@/lib/realtime';

const meta: Meta<typeof ProtocolStatusView> = {
  title: 'Realtime/ProtocolStatusView',
  component: ProtocolStatusView,
  decorators: [withMockRealtime],
  parameters: {
    // Disable animations in Chromatic snapshots.
    chromatic: { pauseAnimationAtEnd: true },
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof ProtocolStatusView>;

// ---------------------------------------------------------------------------
// Healthy — all systems operational.
// ---------------------------------------------------------------------------
export const Healthy: Story = {
  args: {
    initial: {
      level: 'healthy',
      updatedAt: new Date().toISOString(),
    } satisfies ProtocolStatus,
  },
};

// ---------------------------------------------------------------------------
// Degraded — data may be delayed.
// ---------------------------------------------------------------------------
export const Degraded: Story = {
  args: {
    initial: {
      level: 'degraded',
      updatedAt: new Date().toISOString(),
    } satisfies ProtocolStatus,
  },
};

// ---------------------------------------------------------------------------
// Maintenance window — scheduled downtime is announced.
// ---------------------------------------------------------------------------
export const Maintenance: Story = {
  args: {
    initial: {
      level: 'maintenance',
      updatedAt: new Date().toISOString(),
      maintenance: {
        startsAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        message: 'We are upgrading the oracle infrastructure. Data may be intermittently unavailable.',
      },
    } satisfies ProtocolStatus,
  },
};

// ---------------------------------------------------------------------------
// Error / unknown — backend is unreachable.
// ---------------------------------------------------------------------------
export const Unknown: Story = {
  args: {
    initial: {
      level: 'unknown',
      updatedAt: new Date().toISOString(),
    } satisfies ProtocolStatus,
  },
};

// ---------------------------------------------------------------------------
// With active incidents.
// ---------------------------------------------------------------------------
export const WithIncidents: Story = {
  args: {
    initial: {
      level: 'degraded',
      updatedAt: new Date().toISOString(),
      incidents: [
        {
          id: 'inc-1',
          title: 'Elevated oracle latency',
          at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
          resolved: false,
        },
        {
          id: 'inc-2',
          title: 'Stablecoin price feed blip',
          at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          resolved: true,
        },
      ],
    } satisfies ProtocolStatus,
  },
};

// ---------------------------------------------------------------------------
// Live update — component receives a realtime push mid-render.
// Demonstrates the connected → updated transition.
// ---------------------------------------------------------------------------
const HEALTHY_SNAPSHOT: ProtocolStatus = {
  level: 'healthy',
  updatedAt: new Date().toISOString(),
};

const DEGRADED_SNAPSHOT: ProtocolStatus = {
  level: 'degraded',
  updatedAt: new Date().toISOString(),
};

export const LiveUpdate: Story = {
  render: () => {
    useEffect(() => {
      mockRealtimeClient.publish('protocol_status', HEALTHY_SNAPSHOT, 'mock');
      const id = setTimeout(() => {
        mockRealtimeClient.publish('protocol_status', DEGRADED_SNAPSHOT, 'mock');
      }, 1500);
      return () => clearTimeout(id);
    }, []);
    return <ProtocolStatusView />;
  },
  parameters: {
    // Pause after 2 s so Chromatic captures the degraded state.
    chromatic: { delay: 2000, pauseAnimationAtEnd: true },
  },
};
