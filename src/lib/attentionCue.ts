/**
 * Attention-cue service: owns the AudioContext, unlock state and gating.
 * Consumers request a cue by severity and never touch Web Audio directly.
 * See docs/attention-cues.md for the policy.
 */
import type { RefractNotification } from "./notifications";

export const COALESCE_WINDOW_MS = 1_000;
export const QUIET_HOURS = { startHour: 22, endHour: 7 } as const;
const VIBRATION_PATTERN = [120, 60, 120];

export interface CueEnv {
  enabled: () => boolean;
  now: () => Date;
}

type Severity = RefractNotification["severity"];

function inQuietHours(date: Date): boolean {
  const h = date.getHours();
  return h >= QUIET_HOURS.startHour || h < QUIET_HOURS.endHour;
}

export class AttentionCueService {
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private lastCueAt = -Infinity;

  constructor(private env: CueEnv) {}

  /** Call from a user gesture; creates/resumes the AudioContext. */
  unlock(): void {
    if (this.unlocked || typeof AudioContext === "undefined") return;
    this.ctx = new AudioContext();
    void this.ctx.resume?.();
    this.unlocked = true;
  }

  /**
   * Request a cue. Returns true when a cue fired. Replayed/backfilled events,
   * non-critical severities, disabled preference, locked audio, reduced motion,
   * save-data, quiet hours and bursts inside the coalescing window are dropped.
   */
  cue(severity: Severity, opts: { replayed?: boolean } = {}): boolean {
    if (severity !== "critical" || opts.replayed || !this.env.enabled()) return false;
    if (!this.unlocked || !this.ctx) return false;
    if (this.suppressed()) return false;
    const now = this.env.now();
    if (now.getTime() - this.lastCueAt < COALESCE_WINDOW_MS) return false;
    this.lastCueAt = now.getTime();
    this.beep(this.ctx);
    try {
      navigator.vibrate?.(VIBRATION_PATTERN);
    } catch {
      // Unsupported (iOS) — silent no-op.
    }
    return true;
  }

  private suppressed(): boolean {
    if (inQuietHours(this.env.now())) return true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return Boolean(conn?.saveData);
  }

  private beep(ctx: AudioContext): void {
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.unlocked = false;
    this.lastCueAt = -Infinity;
  }
}
