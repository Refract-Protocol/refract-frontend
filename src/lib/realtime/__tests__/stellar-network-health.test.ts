import { describe, expect, it } from 'vitest';
import {
  StellarNetworkHealthMonitor,
  validateStellarNetwork,
} from '../stellar-network-health';

describe('StellarNetworkHealthMonitor', () => {
  it('fails fast on unrecognized network names and builds explorer URLs for valid networks', () => {
    expect(() => validateStellarNetwork('devnet')).toThrow(/Unsupported/);

    const monitor = new StellarNetworkHealthMonitor('testnet');
    const vm = monitor.recordSample({
      checkedAtMs: 50_000,
      latestLedgerSequence: 123456,
      latestLedgerClosedAtMs: 45_000,
      horizonReachable: true,
      sorobanRpcReachable: true,
      roundTripLatencyMs: 320,
    });

    expect(vm.status).toBe('healthy');
    expect(vm.accessibleLabel).toBe('Testnet · Healthy');
    expect(vm.ledgerCloseAgeSeconds).toBe(5);
    expect(vm.explorerUrl).toBe('https://stellar.expert/explorer/testnet/ledger/123456');
  });

  it('applies anti-flap hysteresis on single transient failures and transitions on sustained failures', () => {
    const monitor = new StellarNetworkHealthMonitor('mainnet');

    // First transient failure does not flap badge to degraded
    const firstMiss = monitor.recordSample({
      checkedAtMs: 10_000,
      horizonReachable: false,
      sorobanRpcReachable: true,
    });
    expect(firstMiss.status).toBe('healthy');

    // Second consecutive failure transitions to degraded
    const secondMiss = monitor.recordSample({
      checkedAtMs: 15_000,
      horizonReachable: false,
      sorobanRpcReachable: true,
    });
    expect(secondMiss.status).toBe('degraded');
    expect(secondMiss.accessibleLabel).toBe('Mainnet · Degraded');

    // Third consecutive failure transitions to unavailable
    const thirdMiss = monitor.recordSample({
      checkedAtMs: 20_000,
      horizonReachable: false,
      sorobanRpcReachable: false,
    });
    expect(thirdMiss.status).toBe('unavailable');
    expect(thirdMiss.accessibleLabel).toBe('Mainnet · Unavailable');
  });

  it('respects per-network ledger age thresholds and pauses polling when tab is hidden', () => {
    const mainnetMonitor = new StellarNetworkHealthMonitor('mainnet');
    const futurenetMonitor = new StellarNetworkHealthMonitor('futurenet');

    // 20s ledger age is degraded on mainnet (>12s) but still healthy on futurenet (<25s)
    const mainnetVm = mainnetMonitor.recordSample({
      checkedAtMs: 30_000,
      latestLedgerClosedAtMs: 10_000,
      horizonReachable: true,
      sorobanRpcReachable: true,
    });
    const futurenetVm = futurenetMonitor.recordSample({
      checkedAtMs: 30_000,
      latestLedgerClosedAtMs: 10_000,
      horizonReachable: true,
      sorobanRpcReachable: true,
    });

    expect(mainnetVm.status).toBe('degraded');
    expect(futurenetVm.status).toBe('healthy');

    futurenetMonitor.setTabVisibility(false);
    expect(futurenetMonitor.shouldPoll()).toBe(false);
    expect(futurenetMonitor.getBadgeViewModel().isPollingPaused).toBe(true);
  });
});
