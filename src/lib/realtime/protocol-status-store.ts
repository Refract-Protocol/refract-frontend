export type ProtocolOverallStatus =
  | 'unknown'
  | 'healthy'
  | 'degraded'
  | 'maintenance'
  | 'draining';

export interface MaintenanceWindowRecord {
  id: string;
  title: string;
  startsAtMs: number;
  endsAtMs: number;
  status: 'scheduled' | 'in_progress' | 'completed';
}

export interface IncidentRecord {
  id: string;
  title: string;
  severity: 'minor' | 'major' | 'critical';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  updatedAtMs: number;
  summary: string;
}

export interface ProtocolStatusPayload {
  network: 'mainnet' | 'testnet' | 'futurenet';
  overallStatus: ProtocolOverallStatus;
  updatedAtMs: number;
  maintenanceWindows: MaintenanceWindowRecord[];
  incidents: IncidentRecord[];
}

export interface ProtocolStatusViewModel {
  network: 'mainnet' | 'testnet' | 'futurenet';
  overallStatus: ProtocolOverallStatus;
  accessibleHeadline: string;
  ariaLiveMode: 'polite' | 'assertive';
  lastUpdatedAtMs: number | null;
  activeMaintenance: MaintenanceWindowRecord | null;
  upcomingMaintenance: MaintenanceWindowRecord[];
  activeIncidents: IncidentRecord[];
  resolvedIncidents: IncidentRecord[];
}

const STATUS_HEADLINES: Readonly<Record<ProtocolOverallStatus, string>> = {
  unknown: 'Protocol status unknown — awaiting telemetry',
  healthy: 'All Refract Protocol systems operational',
  degraded: 'Degraded protocol performance detected',
  maintenance: 'Scheduled maintenance in progress',
  draining: 'Realtime gateway draining — reconnecting to healthy node',
};

/**
 * Merges initial REST snapshots with server-initiated realtime control/status frames
 * for the `/status` route while clearing stale state on network switches.
 */
export class ProtocolStatusStore {
  private network: 'mainnet' | 'testnet' | 'futurenet';
  private overallStatus: ProtocolOverallStatus = 'unknown';
  private lastUpdatedAtMs: number | null = null;
  private maintenanceById = new Map<string, MaintenanceWindowRecord>();
  private incidentsById = new Map<string, IncidentRecord>();

  constructor(initialNetwork: 'mainnet' | 'testnet' | 'futurenet' = 'testnet') {
    this.network = initialNetwork;
  }

  /**
   * Switches active network environment and clears any stale banners/incidents from the previous network.
   */
  switchNetwork(nextNetwork: 'mainnet' | 'testnet' | 'futurenet'): void {
    if (this.network === nextNetwork) return;
    this.network = nextNetwork;
    this.overallStatus = 'unknown';
    this.lastUpdatedAtMs = null;
    this.maintenanceById.clear();
    this.incidentsById.clear();
  }

  /**
   * Applies either an initial REST snapshot or a realtime status update if newer.
   */
  applyPayload(payload: ProtocolStatusPayload): boolean {
    if (payload.network !== this.network) {
      return false;
    }
    if (this.lastUpdatedAtMs !== null && payload.updatedAtMs < this.lastUpdatedAtMs) {
      return false;
    }

    this.overallStatus = payload.overallStatus;
    this.lastUpdatedAtMs = payload.updatedAtMs;

    this.maintenanceById.clear();
    for (const mw of payload.maintenanceWindows) {
      this.maintenanceById.set(mw.id, { ...mw });
    }

    this.incidentsById.clear();
    for (const inc of payload.incidents) {
      this.incidentsById.set(inc.id, { ...inc });
    }

    return true;
  }

  /**
   * Handles server-initiated control signals (maintenance start/end, drain, degradation).
   */
  applyRealtimeControlSignal(signal: {
    network: 'mainnet' | 'testnet' | 'futurenet';
    status: ProtocolOverallStatus;
    timestampMs: number;
    maintenanceWindow?: MaintenanceWindowRecord;
    incident?: IncidentRecord;
  }): boolean {
    if (signal.network !== this.network) {
      return false;
    }
    if (this.lastUpdatedAtMs !== null && signal.timestampMs < this.lastUpdatedAtMs) {
      return false;
    }

    this.overallStatus = signal.status;
    this.lastUpdatedAtMs = signal.timestampMs;

    if (signal.maintenanceWindow) {
      this.maintenanceById.set(signal.maintenanceWindow.id, {
        ...signal.maintenanceWindow,
      });
    }
    if (signal.incident) {
      this.incidentsById.set(signal.incident.id, { ...signal.incident });
    }

    return true;
  }

  getViewModel(): ProtocolStatusViewModel {
    const maintenanceList = Array.from(this.maintenanceById.values()).sort(
      (a, b) => a.startsAtMs - b.startsAtMs
    );
    const activeMaintenance =
      maintenanceList.find((m) => m.status === 'in_progress') ?? null;
    const upcomingMaintenance = maintenanceList.filter(
      (m) => m.status === 'scheduled'
    );

    const allIncidents = Array.from(this.incidentsById.values()).sort(
      (a, b) => b.updatedAtMs - a.updatedAtMs
    );
    const activeIncidents = allIncidents.filter((i) => i.status !== 'resolved');
    const resolvedIncidents = allIncidents.filter((i) => i.status === 'resolved');

    return {
      network: this.network,
      overallStatus: this.overallStatus,
      accessibleHeadline: STATUS_HEADLINES[this.overallStatus],
      ariaLiveMode:
        this.overallStatus === 'degraded' || this.overallStatus === 'maintenance'
          ? 'assertive'
          : 'polite',
      lastUpdatedAtMs: this.lastUpdatedAtMs,
      activeMaintenance,
      upcomingMaintenance,
      activeIncidents,
      resolvedIncidents,
    };
  }
}
