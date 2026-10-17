export type NotificationCueSeverity = 'info' | 'warning' | 'critical';

export interface AttentionCuePreferences {
  audioEnabled: boolean;
  hapticsEnabled: boolean;
  prefersReducedMotion: boolean;
  saveData: boolean;
  quietHoursActive: boolean;
}

export interface AttentionCueRequest {
  eventId: string;
  severity: NotificationCueSeverity;
  isBackfill?: boolean;
  occurredAtMs?: number;
}

export interface WebAudioSynthNode {
  frequency: { setValueAtTime: (hz: number, time: number) => void };
  connect: (destination: unknown) => void;
  start: (when?: number) => void;
  stop: (when?: number) => void;
}

export interface WebAudioContextLike {
  state: 'suspended' | 'running' | 'closed';
  currentTime: number;
  destination: unknown;
  resume: () => Promise<void>;
  close: () => Promise<void>;
  createOscillator: () => WebAudioSynthNode;
}

export interface AttentionCueTriggerResult {
  playedAudio: boolean;
  triggeredHaptics: boolean;
  suppressedReason?:
    | 'non_critical_severity'
    | 'backfill_event'
    | 'quiet_hours'
    | 'reduced_motion'
    | 'save_data'
    | 'preferences_disabled'
    | 'audio_locked'
    | 'coalesced_burst';
}

const DEFAULT_PREFERENCES: AttentionCuePreferences = {
  audioEnabled: false, // Off by default per UX/accessibility policy
  hapticsEnabled: false,
  prefersReducedMotion: false,
  saveData: false,
  quietHoursActive: false,
};

/**
 * Central service managing synthesized Web Audio cues and Vibration API haptics
 * for critical realtime notifications while respecting accessibility, autoplay unlock,
 * burst coalescing, and quiet-hours policies.
 */
export class AttentionCueService {
  private prefs: AttentionCuePreferences;
  private readonly createAudioContext?: () => WebAudioContextLike;
  private readonly vibrateFn?: (pattern: number | number[]) => boolean;
  private readonly coalesceWindowMs: number;
  private readonly nowFn: () => number;

  private audioCtx: WebAudioContextLike | null = null;
  private gestureUnlocked = false;
  private lastCueTriggeredAtMs = -Infinity;

  constructor(options: {
    initialPreferences?: Partial<AttentionCuePreferences>;
    createAudioContext?: () => WebAudioContextLike;
    vibrateFn?: (pattern: number | number[]) => boolean;
    coalesceWindowMs?: number;
    nowFn?: () => number;
  } = {}) {
    this.prefs = { ...DEFAULT_PREFERENCES, ...options.initialPreferences };
    this.createAudioContext = options.createAudioContext;
    this.vibrateFn = options.vibrateFn;
    this.coalesceWindowMs = options.coalesceWindowMs ?? 1_500;
    this.nowFn = options.nowFn ?? (() => Date.now());
  }

  getPreferences(): AttentionCuePreferences {
    return { ...this.prefs };
  }

  updatePreferences(patch: Partial<AttentionCuePreferences>): AttentionCuePreferences {
    this.prefs = { ...this.prefs, ...patch };
    return this.getPreferences();
  }

  /**
   * Unlocks Web Audio synthesis on a trusted user gesture (click/keydown).
   */
  async unlockFromUserGesture(): Promise<boolean> {
    this.gestureUnlocked = true;
    if (!this.createAudioContext) {
      return false;
    }
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = this.createAudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    return true;
  }

  isUnlocked(): boolean {
    return this.gestureUnlocked;
  }

  /**
   * Triggers a synthesized audio/haptic cue for critical notifications if allowed by policy.
   * Events arriving before user unlock are dropped immediately rather than queued.
   */
  triggerCue(request: AttentionCueRequest): AttentionCueTriggerResult {
    if (request.severity !== 'critical') {
      return {
        playedAudio: false,
        triggeredHaptics: false,
        suppressedReason: 'non_critical_severity',
      };
    }

    if (request.isBackfill) {
      return {
        playedAudio: false,
        triggeredHaptics: false,
        suppressedReason: 'backfill_event',
      };
    }

    if (this.prefs.quietHoursActive) {
      return {
        playedAudio: false,
        triggeredHaptics: false,
        suppressedReason: 'quiet_hours',
      };
    }

    if (this.prefs.prefersReducedMotion) {
      return {
        playedAudio: false,
        triggeredHaptics: false,
        suppressedReason: 'reduced_motion',
      };
    }

    if (this.prefs.saveData) {
      return {
        playedAudio: false,
        triggeredHaptics: false,
        suppressedReason: 'save_data',
      };
    }

    if (!this.prefs.audioEnabled && !this.prefs.hapticsEnabled) {
      return {
        playedAudio: false,
        triggeredHaptics: false,
        suppressedReason: 'preferences_disabled',
      };
    }

    const now = this.nowFn();
    if (now - this.lastCueTriggeredAtMs < this.coalesceWindowMs) {
      return {
        playedAudio: false,
        triggeredHaptics: false,
        suppressedReason: 'coalesced_burst',
      };
    }

    let playedAudio = false;
    let triggeredHaptics = false;

    if (this.prefs.audioEnabled) {
      if (this.gestureUnlocked && this.audioCtx && this.audioCtx.state !== 'closed') {
        const osc = this.audioCtx.createOscillator();
        const t0 = this.audioCtx.currentTime;
        osc.frequency.setValueAtTime(880, t0);
        osc.connect(this.audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.12);
        playedAudio = true;
      } else if (!this.prefs.hapticsEnabled) {
        return {
          playedAudio: false,
          triggeredHaptics: false,
          suppressedReason: 'audio_locked',
        };
      }
    }

    if (this.prefs.hapticsEnabled && typeof this.vibrateFn === 'function') {
      try {
        triggeredHaptics = Boolean(this.vibrateFn([80, 40, 80]));
      } catch {
        triggeredHaptics = false;
      }
    }

    if (playedAudio || triggeredHaptics) {
      this.lastCueTriggeredAtMs = now;
    }

    return { playedAudio, triggeredHaptics };
  }

  /**
   * Releases the underlying AudioContext hardware handle on teardown/unmount.
   */
  async dispose(): Promise<void> {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      await this.audioCtx.close();
    }
    this.audioCtx = null;
    this.gestureUnlocked = false;
  }
}
