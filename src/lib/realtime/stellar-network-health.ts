export type StellarNetworkName = 'mainnet' | 'testnet' | 'futurenet';
export type NetworkHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface NetworkHealthThresholds {
  degradedLedgerAgeMs: number;
  unavailableLedgerAgeMs: number;
  degradedLatencyMs: number;
  consecutiveFailuresForDegraded: number;
  consecutiveFailuresForUnavailable: number;
}

export interface NetworkHealthCheckSample {
  checkedAtMs: number;
  latestLedgerSequence?: number;
  latestLedgerClosedAtMs?: number;
  horizonReachable: boolean;
  sorobanRpcReachable: boolean;
  roundTripLatencyMs?: number;
}

export interface NavbarNetworkBadgeViewModel {
  network: StellarNetworkName;
  status: NetworkHealthStatus;
  accessibleLabel: string;
  ledgerCloseAgeSeconds: number | null;
  latestLedgerSequence: number | null;
  explorerUrl: string;
  tooltipSummary: string;
  isPollingPaused: boolean;
}

export const NETWORK_HEALTH_THRESHOLDS: Readonly<
  Record<StellarNetworkName, NetworkHealthThresholds>
> = {
  mainnet: {
    degradedLedgerAgeMs: 12_000,
    unavailableLedgerAgeMs: 30_000,
    degradedLatencyMs: 2_500,
    consecutiveFailuresForDegraded: 2,
    consecutiveFailuresForUnavailable: 3,
  },
  testnet: {
    degradedLedgerAgeMs: 18_000,
    unavailableLedgerAgeMs: 45_000,
    degradedLatencyMs: 3_500,
    consecutiveFailuresForDegraded: 2,
    consecutiveFailuresForUnavailable: 3,
  },
  futurenet: {
    degradedLedgerAgeMs: 25_000,
    unavailableLedgerAgeMs: 60_000,
    degradedLatencyMs: 5_000,
    consecutiveFailuresForDegraded: 2,
    consecutiveFailuresForUnavailable: 4,
  },
};

const EXPLORER_BASE_URLS: Readonly<Record<StellarNetworkName, string>> = {
  mainnet: 'https://stellar.expert/explorer/public',
  testnet: 'https://stellar.expert/explorer/testnet',
  futurenet: 'https://futurenet.steexp.com',
};

export function validateStellarNetwork(network: string): StellarNetworkName {
  if (network === 'mainnet' || network === 'testnet' || network === 'futurenet') {
    return network;
  }
  throw new Error(`Unsupported NEXT_PUBLIC_STELLAR_NETWORK value: "${network}"`);
}

export function getNetworkExplorerUrl(
  network: StellarNetworkName,
  ledgerSequence?: number | null
): string {
  const base = EXPLORER_BASE_URLS[network];
  if (ledgerSequence && ledgerSequence > 0) {
    return `${base}/ledger/${ledgerSequence}`;
  }
  return base;
}

/**
 * Tracks Stellar ledger close recency, Horizon liveness, and Soroban RPC reachability
 * with anti-flap hysteresis for the Navbar network badge.
 */
export class StellarNetworkHealthMonitor {
  private readonly network: StellarNetworkName;
  private readonly thresholds: NetworkHealthThresholds;
  private status: NetworkHealthStatus = 'healthy';
  private consecutiveFailures = 0;
  private latestLedgerSequence: number | null = null;
  private latestLedgerAgeMs: number | null = null;
  private tabVisible = true;

  constructor(
    networkInput: string,
    customThresholds?: Partial<NetworkHealthThresholds>
  ) {
    this.network = validateStellarNetwork(networkInput);
    this.thresholds = {
      ...NETWORK_HEALTH_THRESHOLDS[this.network],
      ...customThresholds,
    };
  }

  setTabVisibility(visible: boolean): void {
    this.tabVisible = visible;
  }

  shouldPoll(): boolean {
    return this.tabVisible;
  }

  recordSample(sample: NetworkHealthCheckSample): NavbarNetworkBadgeViewModel {
    if (sample.latestLedgerSequence !== undefined) {
      this.latestLedgerSequence = sample.latestLedgerSequence;
    }

    const ledgerAgeMs =
      sample.latestLedgerClosedAtMs !== undefined
        ? Math.max(0, sample.checkedAtMs - sample.latestLedgerClosedAtMs)
        : null;
    if (ledgerAgeMs !== null) {
      this.latestLedgerAgeMs = ledgerAgeMs;
    }

    const endpointsReachable = sample.horizonReachable && sample.sorobanRpcReachable;
    if (!endpointsReachable) {
      this.consecutiveFailures += 1;
    } else {
      this.consecutiveFailures = 0;
    }

    this.status = this.evaluateStatus(endpointsReachable, ledgerAgeMs, sample.roundTripLatencyMs);
    return this.getBadgeViewModel();
  }

  getBadgeViewModel(): NavbarNetworkBadgeViewModel {
    const networkTitle =
      this.network.charAt(0).toUpperCase() + this.network.slice(1);
    const statusLabel =
      this.status === 'healthy'
        ? 'Healthy'
        : this.status === 'degraded'
          ? 'Degraded'
          : 'Unavailable';

    const ledgerCloseAgeSeconds =
      this.latestLedgerAgeMs !== null
        ? Math.round(this.latestLedgerAgeMs / 1000)
        : null;

    const agePart =
      ledgerCloseAgeSeconds !== null
        ? `Last ledger closed ${ledgerCloseAgeSeconds}s ago`
        : 'Awaiting initial ledger sample';

    return {
      network: this.network,
      status: this.status,
      accessibleLabel: `${networkTitle} · ${statusLabel}`,
      ledgerCloseAgeSeconds,
      latestLedgerSequence: this.latestLedgerSequence,
      explorerUrl: getNetworkExplorerUrl(this.network, this.latestLedgerSequence),
      tooltipSummary: `${networkTitle} is ${statusLabel.toLowerCase()}. ${agePart}.`,
      isPollingPaused: !this.tabVisible,
    };
  }

  private evaluateStatus(
    endpointsReachable: boolean,
    ledgerAgeMs: number | null,
    latencyMs?: number
  ): NetworkHealthStatus {
    if (!endpointsReachable) {
      if (this.consecutiveFailures >= this.thresholds.consecutiveFailuresForUnavailable) {
        return 'unavailable';
      }
      if (this.consecutiveFailures >= this.thresholds.consecutiveFailuresForDegraded) {
        return 'degraded';
      }
      // Single transient failure does not flap out of current state
      return this.status;
    }

    if (ledgerAgeMs !== null) {
      if (ledgerAgeMs >= this.thresholds.unavailableLedgerAgeMs) {
        return 'unavailable';
      }
      if (ledgerAgeMs >= this.thresholds.degradedLedgerAgeMs) {
        return 'degraded';
      }
    }

    if (latencyMs !== undefined && latencyMs >= this.thresholds.degradedLatencyMs) {
      return 'degraded';
    }

    return 'healthy';
  }
}
