export type EmulatedNetworkProfile =
  | 'normal'
  | 'high_latency'
  | 'packet_loss'
  | 'hard_offline';

export interface SequencedRealtimeFrame {
  eventId: string;
  topic: string;
  sequence: number;
  payload: unknown;
}

export interface NetworkConditionHarnessState {
  profile: EmulatedNetworkProfile;
  transportActive: boolean;
  restFallbackActive: boolean;
  degradedBannerVisible: boolean;
  activeSubscriptions: string[];
  lastCursorSequence: number;
  deliveredEvents: SequencedRealtimeFrame[];
}

export interface NetworkProfileConfig {
  simulatedRttMs: number;
  dropEveryNthFrame: number; // 0 = no drop
  degradedThresholdMs: number;
}

const PROFILE_CONFIGS: Readonly<Record<EmulatedNetworkProfile, NetworkProfileConfig>> = {
  normal: { simulatedRttMs: 40, dropEveryNthFrame: 0, degradedThresholdMs: 1_500 },
  high_latency: { simulatedRttMs: 2_200, dropEveryNthFrame: 0, degradedThresholdMs: 1_500 },
  packet_loss: { simulatedRttMs: 450, dropEveryNthFrame: 2, degradedThresholdMs: 1_500 },
  hard_offline: { simulatedRttMs: Infinity, dropEveryNthFrame: 1, degradedThresholdMs: 1_500 },
};

/**
 * Deterministic network-condition emulation harness for Playwright and integration suites,
 * testing high latency, packet loss, hard offline, and cursor-based recovery without duplicates.
 */
export class NetworkConditionRealtimeHarness {
  private profile: EmulatedNetworkProfile = 'normal';
  private readonly subscriptions = new Set<string>();
  private readonly serverOutbox: SequencedRealtimeFrame[] = [];
  private readonly deliveredById = new Map<string, SequencedRealtimeFrame>();
  private lastCursorSequence = 0;
  private frameAttemptCounter = 0;

  subscribe(topic: string): void {
    this.subscriptions.add(topic);
  }

  unsubscribe(topic: string): void {
    this.subscriptions.delete(topic);
  }

  setNetworkProfile(profile: EmulatedNetworkProfile): NetworkConditionHarnessState {
    const previous = this.profile;
    this.profile = profile;

    if (previous !== 'normal' && profile === 'normal') {
      this.resubscribeAndCatchUp();
    }

    return this.getState();
  }

  /**
   * Pushes an event on the mock server timeline and routes it according to the active network profile.
   */
  pushServerFrame(frame: SequencedRealtimeFrame): {
    deliveredOverSocket: boolean;
    bufferedForRecovery: boolean;
  } {
    this.serverOutbox.push(frame);
    this.frameAttemptCounter += 1;

    if (this.profile === 'hard_offline') {
      return { deliveredOverSocket: false, bufferedForRecovery: true };
    }

    const cfg = PROFILE_CONFIGS[this.profile];
    if (
      cfg.dropEveryNthFrame > 0 &&
      this.frameAttemptCounter % cfg.dropEveryNthFrame === 0
    ) {
      // Packet dropped on lossy link; recovered via REST fallback or cursor catch-up
      return { deliveredOverSocket: false, bufferedForRecovery: true };
    }

    this.deliverFrame(frame);
    return { deliveredOverSocket: true, bufferedForRecovery: false };
  }

  /**
   * Simulates a REST fallback poll that reconciles any missing frames while socket is degraded or offline.
   */
  runRestFallbackPoll(): number {
    let reconciled = 0;
    for (const frame of this.serverOutbox) {
      if (
        this.subscriptions.has(frame.topic) &&
        !this.deliveredById.has(frame.eventId)
      ) {
        this.deliverFrame(frame);
        reconciled += 1;
      }
    }
    return reconciled;
  }

  getState(): NetworkConditionHarnessState {
    const cfg = PROFILE_CONFIGS[this.profile];
    const transportActive = this.profile !== 'hard_offline';
    const isUnhealthy =
      !transportActive ||
      cfg.simulatedRttMs >= cfg.degradedThresholdMs ||
      cfg.dropEveryNthFrame > 0;

    const deliveredEvents = Array.from(this.deliveredById.values()).sort(
      (a, b) => a.sequence - b.sequence
    );

    return {
      profile: this.profile,
      transportActive,
      restFallbackActive: isUnhealthy,
      degradedBannerVisible: isUnhealthy,
      activeSubscriptions: Array.from(this.subscriptions).sort(),
      lastCursorSequence: this.lastCursorSequence,
      deliveredEvents,
    };
  }

  private resubscribeAndCatchUp(): void {
    for (const frame of this.serverOutbox) {
      if (
        this.subscriptions.has(frame.topic) &&
        frame.sequence > this.lastCursorSequence
      ) {
        this.deliverFrame(frame);
      }
    }
  }

  private deliverFrame(frame: SequencedRealtimeFrame): void {
    if (!this.subscriptions.has(frame.topic)) return;
    if (this.deliveredById.has(frame.eventId)) return;

    this.deliveredById.set(frame.eventId, frame);
    if (frame.sequence > this.lastCursorSequence) {
      this.lastCursorSequence = frame.sequence;
    }
  }
}
