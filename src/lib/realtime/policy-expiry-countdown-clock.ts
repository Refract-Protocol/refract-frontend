export type PolicyBoundaryState = 'active' | 'claim_window_open' | 'expired';

export interface PolicyCountdownInput {
  policyId: string;
  startTimestampMs: number;
  claimWindowStartMs?: number;
  expiryTimestampMs: number;
}

export interface PolicyBoundaryEvent {
  policyId: string;
  boundary: 'claim_window_start' | 'policy_expired';
  triggeredAtServerMs: number;
  previousState: PolicyBoundaryState;
  nextState: PolicyBoundaryState;
}

export interface PolicyCountdownSnapshot {
  policyId: string;
  serverNowMs: number;
  remainingMs: number;
  elapsedMs: number;
  totalDurationMs: number;
  progressRatio: number;
  state: PolicyBoundaryState;
  animateProgress: boolean;
  formattedCountdown: string;
}

export interface PolicyExpiryClockOptions {
  initialServerOffsetMs?: number;
  prefersReducedMotion?: boolean;
  nowFn?: () => number;
  onBoundaryEvent?: (event: PolicyBoundaryEvent) => void;
}

/**
 * Formats non-negative milliseconds into a compact human-readable countdown string.
 * Clamps negative durations to 0s so UI never displays "-00:00:01".
 */
export function formatRemainingDuration(remainingMs: number): string {
  const clampedMs = Math.max(0, Math.floor(remainingMs));
  const totalSeconds = Math.floor(clampedMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number): string => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Coordinates policy expiry countdowns against server-authoritative time offsets
 * and emits discrete boundary events at claim window opening and policy expiration.
 */
export class PolicyExpiryCountdownClock {
  private serverOffsetMs: number;
  private prefersReducedMotion: boolean;
  private readonly nowFn: () => number;
  private readonly onBoundaryEvent?: (event: PolicyBoundaryEvent) => void;
  private readonly policies = new Map<string, PolicyCountdownInput>();
  private readonly lastKnownState = new Map<string, PolicyBoundaryState>();
  private readonly firedBoundaries = new Set<string>();
  private isTabVisible = true;

  constructor(options: PolicyExpiryClockOptions = {}) {
    this.serverOffsetMs = options.initialServerOffsetMs ?? 0;
    this.prefersReducedMotion = options.prefersReducedMotion ?? false;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.onBoundaryEvent = options.onBoundaryEvent;
  }

  /**
   * Synchronizes the local clock with a server-authoritative timestamp.
   */
  syncServerTime(serverTimestampMs: number, clientReceiveTimeMs = this.nowFn()): number {
    if (Number.isFinite(serverTimestampMs) && Number.isFinite(clientReceiveTimeMs)) {
      this.serverOffsetMs = serverTimestampMs - clientReceiveTimeMs;
    }
    return this.serverOffsetMs;
  }

  getServerNowMs(): number {
    return this.nowFn() + this.serverOffsetMs;
  }

  setReducedMotion(reduced: boolean): void {
    this.prefersReducedMotion = reduced;
  }

  registerPolicy(policy: PolicyCountdownInput): PolicyCountdownSnapshot {
    this.policies.set(policy.policyId, { ...policy });
    const initialState = this.computeState(policy, this.getServerNowMs());
    this.lastKnownState.set(policy.policyId, initialState);
    if (initialState === 'claim_window_open') {
      this.firedBoundaries.add(`${policy.policyId}:claim_window_start`);
    } else if (initialState === 'expired') {
      this.firedBoundaries.add(`${policy.policyId}:claim_window_start`);
      this.firedBoundaries.add(`${policy.policyId}:policy_expired`);
    }
    return this.getSnapshot(policy.policyId)!;
  }

  unregisterPolicy(policyId: string): void {
    this.policies.delete(policyId);
    this.lastKnownState.delete(policyId);
    this.firedBoundaries.delete(`${policyId}:claim_window_start`);
    this.firedBoundaries.delete(`${policyId}:policy_expired`);
  }

  /**
   * Handles tab visibility transitions and immediately recomputes all countdowns on resume.
   */
  setTabVisibility(visible: boolean): PolicyCountdownSnapshot[] {
    this.isTabVisible = visible;
    if (visible) {
      return this.tick();
    }
    return [];
  }

  isVisible(): boolean {
    return this.isTabVisible;
  }

  /**
   * Evaluates all registered policies at current server time and emits boundary transitions.
   */
  tick(): PolicyCountdownSnapshot[] {
    const serverNow = this.getServerNowMs();
    const snapshots: PolicyCountdownSnapshot[] = [];

    for (const policy of this.policies.values()) {
      const snapshot = this.evaluatePolicy(policy, serverNow);
      snapshots.push(snapshot);
    }

    return snapshots;
  }

  getSnapshot(policyId: string): PolicyCountdownSnapshot | null {
    const policy = this.policies.get(policyId);
    if (!policy) return null;
    return this.evaluatePolicy(policy, this.getServerNowMs());
  }

  private computeState(policy: PolicyCountdownInput, serverNowMs: number): PolicyBoundaryState {
    if (serverNowMs >= policy.expiryTimestampMs) {
      return 'expired';
    }
    if (
      policy.claimWindowStartMs !== undefined &&
      serverNowMs >= policy.claimWindowStartMs
    ) {
      return 'claim_window_open';
    }
    return 'active';
  }

  private evaluatePolicy(
    policy: PolicyCountdownInput,
    serverNowMs: number
  ): PolicyCountdownSnapshot {
    const prevState = this.lastKnownState.get(policy.policyId) ?? 'active';
    const nextState = this.computeState(policy, serverNowMs);

    if (
      policy.claimWindowStartMs !== undefined &&
      serverNowMs >= policy.claimWindowStartMs &&
      !this.firedBoundaries.has(`${policy.policyId}:claim_window_start`)
    ) {
      this.firedBoundaries.add(`${policy.policyId}:claim_window_start`);
      this.onBoundaryEvent?.({
        policyId: policy.policyId,
        boundary: 'claim_window_start',
        triggeredAtServerMs: serverNowMs,
        previousState: prevState,
        nextState: nextState === 'expired' ? 'claim_window_open' : nextState,
      });
    }

    if (
      serverNowMs >= policy.expiryTimestampMs &&
      !this.firedBoundaries.has(`${policy.policyId}:policy_expired`)
    ) {
      this.firedBoundaries.add(`${policy.policyId}:policy_expired`);
      this.onBoundaryEvent?.({
        policyId: policy.policyId,
        boundary: 'policy_expired',
        triggeredAtServerMs: serverNowMs,
        previousState:
          policy.claimWindowStartMs !== undefined ? 'claim_window_open' : prevState,
        nextState: 'expired',
      });
    }

    this.lastKnownState.set(policy.policyId, nextState);

    const totalDurationMs = Math.max(1, policy.expiryTimestampMs - policy.startTimestampMs);
    const remainingMs = Math.max(0, policy.expiryTimestampMs - serverNowMs);
    const elapsedMs = Math.min(
      totalDurationMs,
      Math.max(0, serverNowMs - policy.startTimestampMs)
    );
    const progressRatio = Number((elapsedMs / totalDurationMs).toFixed(4));

    return {
      policyId: policy.policyId,
      serverNowMs,
      remainingMs,
      elapsedMs,
      totalDurationMs,
      progressRatio,
      state: nextState,
      animateProgress: !this.prefersReducedMotion && this.isTabVisible && remainingMs > 0,
      formattedCountdown: formatRemainingDuration(remainingMs),
    };
  }
}
