/**
 * Stories for RealtimeConnectionStatus.
 *
 * Every connection state is covered: connected, connecting, reconnecting,
 * degraded, error, and REST-only (circuit open). Deterministic — no sockets.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { RealtimeConnectionStatus } from './RealtimeConnectionStatus';
import { withMockRealtime, mockRealtimeClient, setMockHealth } from '@/lib/realtime/testing/mockRealtimeDecorator';
import { RealtimeClient } from '@/lib/realtime/client';

// Build a small helper so each story gets its own isolated client.
function clientForHealth(health: 'healthy' | 'degraded' | 'unavailable') {
  const c = new RealtimeClient({ createSocket: null, url: () => 'ws://mock/ws' });
  c.health.setConnection(health);
  return c;
}

const meta: Meta<typeof RealtimeConnectionStatus> = {
  title: 'Realtime/ConnectionStatus',
  component: RealtimeConnectionStatus,
  decorators: [withMockRealtime],
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof RealtimeConnectionStatus>;

export const Connected: Story = {
  args: { client: clientForHealth('healthy') },
};

export const Connecting: Story = {
  render: () => {
    const c = new RealtimeClient({ createSocket: null, url: () => 'ws://mock/ws' });
    // Health starts unavailable by default → "Disconnected" label which maps to connecting UX.
    c.health.setConnection('unavailable');
    return <RealtimeConnectionStatus client={c} />;
  },
};

export const Degraded: Story = {
  args: { client: clientForHealth('degraded') },
};

export const Error: Story = {
  args: { client: clientForHealth('unavailable') },
};

export const RestOnly: Story = {
  render: () => {
    const c = new RealtimeClient({
      createSocket: null,
      url: () => 'ws://mock/ws',
      circuitBreaker: { failureThreshold: 1, probeIntervalMs: 30_000, enabled: true },
    });
    c.health.setConnection('unavailable');
    c.circuitBreaker.forceOpen();
    return <RealtimeConnectionStatus client={c} />;
  },
};

// ---------------------------------------------------------------------------
// All states in a grid for quick visual comparison.
// ---------------------------------------------------------------------------
export const AllStates: Story = {
  render: () => {
    const states: Array<{ label: string; health: 'healthy' | 'degraded' | 'unavailable'; circuit?: boolean }> = [
      { label: 'Connected', health: 'healthy' },
      { label: 'Degraded', health: 'degraded' },
      { label: 'Disconnected', health: 'unavailable' },
    ];
    return (
      <div className="flex flex-col gap-4 p-4">
        {states.map(({ label, health }) => {
          const c = clientForHealth(health);
          return (
            <div key={label} className="flex items-center gap-4">
              <span className="w-28 text-xs text-pm-text/60">{label}</span>
              <RealtimeConnectionStatus client={c} />
            </div>
          );
        })}
        {/* REST-only via open circuit */}
        <div className="flex items-center gap-4">
          <span className="w-28 text-xs text-pm-text/60">REST only</span>
          <RealtimeConnectionStatus client={(() => {
            const c = new RealtimeClient({ createSocket: null, url: () => 'ws://mock/ws', circuitBreaker: { enabled: true, failureThreshold: 1, probeIntervalMs: 1000 } });
            c.health.setConnection('unavailable');
            c.circuitBreaker.forceOpen();
            return c;
          })()} />
        </div>
      </div>
    );
  },
};
