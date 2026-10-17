import { describe, expect, it } from 'vitest';
import { ProtocolStatusStore } from '../protocol-status-store';

describe('ProtocolStatusStore', () => {
  it('transitions from initial REST snapshot to maintenance and back to healthy via realtime signals', () => {
    const store = new ProtocolStatusStore('mainnet');
    expect(store.getViewModel().overallStatus).toBe('unknown');

    store.applyPayload({
      network: 'mainnet',
      overallStatus: 'healthy',
      updatedAtMs: 10_000,
      maintenanceWindows: [
        {
          id: 'mw-1',
          title: 'Soroban RPC Upgrade',
          startsAtMs: 20_000,
          endsAtMs: 40_000,
          status: 'scheduled',
        },
      ],
      incidents: [],
    });

    expect(store.getViewModel().overallStatus).toBe('healthy');
    expect(store.getViewModel().upcomingMaintenance).toHaveLength(1);

    // Pushed realtime control signal transitions to maintenance
    store.applyRealtimeControlSignal({
      network: 'mainnet',
      status: 'maintenance',
      timestampMs: 20_000,
      maintenanceWindow: {
        id: 'mw-1',
        title: 'Soroban RPC Upgrade',
        startsAtMs: 20_000,
        endsAtMs: 40_000,
        status: 'in_progress',
      },
    });

    const inMaint = store.getViewModel();
    expect(inMaint.overallStatus).toBe('maintenance');
    expect(inMaint.activeMaintenance?.id).toBe('mw-1');
    expect(inMaint.ariaLiveMode).toBe('assertive');

    // Completion signal returns to healthy
    store.applyRealtimeControlSignal({
      network: 'mainnet',
      status: 'healthy',
      timestampMs: 40_000,
      maintenanceWindow: {
        id: 'mw-1',
        title: 'Soroban RPC Upgrade',
        startsAtMs: 20_000,
        endsAtMs: 40_000,
        status: 'completed',
      },
    });

    expect(store.getViewModel().overallStatus).toBe('healthy');
    expect(store.getViewModel().activeMaintenance).toBeNull();
  });

  it('clears stale banners and incidents when switching Stellar networks', () => {
    const store = new ProtocolStatusStore('testnet');
    store.applyRealtimeControlSignal({
      network: 'testnet',
      status: 'degraded',
      timestampMs: 5_000,
      incident: {
        id: 'inc-1',
        title: 'Horizon indexing lag',
        severity: 'major',
        status: 'investigating',
        updatedAtMs: 5_000,
        summary: 'Elevated ledger ingestion latency on testnet.',
      },
    });

    expect(store.getViewModel().activeIncidents).toHaveLength(1);

    store.switchNetwork('mainnet');
    const afterSwitch = store.getViewModel();
    expect(afterSwitch.network).toBe('mainnet');
    expect(afterSwitch.overallStatus).toBe('unknown');
    expect(afterSwitch.activeIncidents).toHaveLength(0);
  });
});
