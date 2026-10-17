export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;
export const DEFAULT_PONG_DEADLINE_MS = 10_000;
export const DEFAULT_MAX_MISSED_PONGS = 2;

export interface HeartbeatPingFrame {
  v: 1;
  type: "ping";
  id: string;
  ts: number;
}

export interface HeartbeatPongFrame {
  v?: number;
  type: "pong";
  id?: string;
  ts?: number;
  serverTs?: number;
}

export interface RealtimeHeartbeatState {
  enabled: boolean;
  running: boolean;
  paused: boolean;
  healthy: boolean;
  lastPingAt: number | null;
  lastPongAt: number | null;
  lastRttMs: number | null;
  consecutiveMisses: number;
  totalPingsSent: number;
  totalPongsReceived: number;
  totalTimeouts: number;
}

export type HeartbeatStateListener = (state: RealtimeHeartbeatState) => void;

export interface HeartbeatMonitorOptions {
  /** Interval (ms) between outbound ping frames (default: 25_000). */
  intervalMs?: number;
  /** Deadline (ms) within which a pong or inbound traffic must arrive after a ping (default: 10_000). */
  pongDeadlineMs?: number;
  /** Number of consecutive missed pongs before declaring the connection dead (default: 2). */
  maxMissedPongs?: number;
  /** Whether the heartbeat monitor is enabled (can be disabled for offline dev mocks). */
  enabled?: boolean;
  /** Callback invoked to transmit a `ping` frame over the active socket. */
  sendPing: (frame: HeartbeatPingFrame) => void;
  /** Callback invoked when `consecutiveMisses >= maxMissedPongs` to close and reconnect. */
  onStaleConnection: (state: RealtimeHeartbeatState) => void;
  /** Monotonic/epoch clock function for deterministic testing ( never relies on server clock for deadlines). */
  now?: () => number;
}

/**
 * Application-level heartbeat and idle-connection detector for the realtime transport.
 * Manages periodic `ping` frames and `pong` deadlines using local monotonic timestamps
 * (avoiding server clock-skew false positives), exposes live health metrics, and
 * guarantees zero leaked timers across teardown or background-tab pause cycles.
 */
export class RealtimeHeartbeatMonitor {
  private readonly intervalMs: number;
  private readonly pongDeadlineMs: number;
  private readonly maxMissedPongs: number;
  private enabled: boolean;
  private readonly sendPing: (frame: HeartbeatPingFrame) => void;
  private readonly onStaleConnection: (state: RealtimeHeartbeatState) => void;
  private readonly now: () => number;

  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private paused = false;
  private healthy = true;
  private lastPingAt: number | null = null;
  private lastPongAt: number | null = null;
  private lastRttMs: number | null = null;
  private consecutiveMisses = 0;
  private totalPingsSent = 0;
  private totalPongsReceived = 0;
  private totalTimeouts = 0;
  private pingCounter = 0;
  private readonly listeners = new Set<HeartbeatStateListener>();

  constructor(options: HeartbeatMonitorOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.pongDeadlineMs = options.pongDeadlineMs ?? DEFAULT_PONG_DEADLINE_MS;
    this.maxMissedPongs = Math.max(1, options.maxMissedPongs ?? DEFAULT_MAX_MISSED_PONGS);
    this.enabled = options.enabled ?? true;
    this.sendPing = options.sendPing;
    this.onStaleConnection = options.onStaleConnection;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Starts the heartbeat loop for an open connection. Safe to call repeatedly;
   * clears any prior timers before starting.
   */
  start(): void {
    this.clearTimers();
    this.running = true;
    this.paused = false;
    this.healthy = true;
    this.consecutiveMisses = 0;
    this.emitState();

    if (!this.enabled) return;

    this.intervalTimer = setInterval(() => {
      this.sendHeartbeatPing();
    }, this.intervalMs);
  }

  /**
   * Temporarily suspends heartbeat timers (e.g. when a tab is hidden or offline)
   * so background timer throttling does not trigger false reconnect storms.
   */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.clearTimers();
    this.emitState();
  }

  /**
   * Resumes heartbeat timers after a background pause and immediately dispatches
   * a probe ping to verify the connection survived suspension.
   */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.emitState();
    if (!this.enabled) return;

    this.sendHeartbeatPing();
    this.intervalTimer = setInterval(() => {
      this.sendHeartbeatPing();
    }, this.intervalMs);
  }

  /**
   * Stops the heartbeat monitor and guarantees all timers are cleared on socket close/unmount.
   */
  stop(): void {
    this.clearTimers();
    this.running = false;
    this.paused = false;
    this.emitState();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearTimers();
      this.emitState();
    } else if (this.running && !this.paused && !this.intervalTimer) {
      this.intervalTimer = setInterval(() => {
        this.sendHeartbeatPing();
      }, this.intervalMs);
      this.emitState();
    }
  }

  /**
   * Records a `pong` (or any authoritative inbound traffic from the peer),
   * cancelling the active deadline timer and resetting `consecutiveMisses`.
   */
  recordPong(pong?: HeartbeatPongFrame): void {
    const receivedAt = this.now();
    this.lastPongAt = receivedAt;
    this.totalPongsReceived += 1;

    if (this.lastPingAt !== null) {
      this.lastRttMs = Math.max(0, receivedAt - this.lastPingAt);
    } else if (pong?.ts !== undefined) {
      this.lastRttMs = Math.max(0, receivedAt - pong.ts);
    }

    if (this.deadlineTimer !== null) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }

    this.consecutiveMisses = 0;
    this.healthy = true;
    this.emitState();
  }

  private sendHeartbeatPing(): void {
    if (!this.running || this.paused || !this.enabled) return;

    const sentAt = this.now();
    this.pingCounter += 1;
    this.lastPingAt = sentAt;
    this.totalPingsSent += 1;

    const frame: HeartbeatPingFrame = {
      v: 1,
      type: "ping",
      id: `hb_${this.pingCounter}`,
      ts: sentAt,
    };

    this.sendPing(frame);

    if (this.deadlineTimer !== null) {
      clearTimeout(this.deadlineTimer);
    }

    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      this.handleMissedPong();
    }, this.pongDeadlineMs);

    this.emitState();
  }

  private handleMissedPong(): void {
    if (!this.running || this.paused || !this.enabled) return;

    this.consecutiveMisses += 1;
    this.totalTimeouts += 1;

    if (this.consecutiveMisses >= this.maxMissedPongs) {
      this.healthy = false;
      this.clearTimers();
      this.running = false;
      const snapshot = this.getState();
      this.emitState();
      this.onStaleConnection(snapshot);
      return;
    }

    this.emitState();
  }

  private clearTimers(): void {
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.deadlineTimer !== null) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
  }

  getState(): RealtimeHeartbeatState {
    return {
      enabled: this.enabled,
      running: this.running,
      paused: this.paused,
      healthy: this.healthy,
      lastPingAt: this.lastPingAt,
      lastPongAt: this.lastPongAt,
      lastRttMs: this.lastRttMs,
      consecutiveMisses: this.consecutiveMisses,
      totalPingsSent: this.totalPingsSent,
      totalPongsReceived: this.totalPongsReceived,
      totalTimeouts: this.totalTimeouts,
    };
  }

  onStateChange(listener: HeartbeatStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitState(): void {
    if (this.listeners.size === 0) return;
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }
}
