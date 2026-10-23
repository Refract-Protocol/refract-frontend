import { realtimeClient } from "./client";
import type { RealtimeTopic } from "./topics";

export type FidelityTier = "full" | "lite" | "minimal";

export interface FidelityProfile {
  /** Topics held on the wire in this tier. */
  topics: readonly RealtimeTopic[];
  /** Minimum ms between delivered events per volatile topic (0 = deliver all). */
  coalesceMs: Partial<Record<RealtimeTopic, number>>;
  transport: "websocket" | "polling";
}

/** Declarative tier definitions — mirrored in docs/realtime-fidelity.md. */
export const FIDELITY_PROFILES: Record<FidelityTier, FidelityProfile> = {
  full: {
    topics: ["oracle_update", "protocol_status", "network_health"],
    coalesceMs: {},
    transport: "websocket",
  },
  lite: {
    topics: ["oracle_update", "protocol_status"],
    coalesceMs: { oracle_update: 5_000 },
    transport: "websocket",
  },
  minimal: { topics: ["protocol_status"], coalesceMs: {}, transport: "polling" },
};

export const TIER_ORDER: readonly FidelityTier[] = ["full", "lite", "minimal"];

/** Hold times before a tier change is applied, so a flapping connection does not thrash. */
export const DOWNGRADE_HOLD_MS = 3_000;
export const UPGRADE_HOLD_MS = 30_000;

export interface FidelitySignals {
  effectiveType?: string;
  saveData?: boolean;
  batteryLevel?: number;
  charging?: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/** Pure tier selection from signals; missing signals assume an unconstrained client. */
export function selectTier(s: FidelitySignals): FidelityTier {
  if (s.saveData || s.effectiveType === "slow-2g" || s.effectiveType === "2g") return "minimal";
  const lowBattery = s.batteryLevel !== undefined && s.batteryLevel < 0.15 && !s.charging;
  const weakDevice =
    (s.deviceMemory !== undefined && s.deviceMemory <= 2) ||
    (s.hardwareConcurrency !== undefined && s.hardwareConcurrency <= 2);
  if (lowBattery) return "minimal";
  if (
    s.effectiveType === "3g" ||
    weakDevice ||
    (s.batteryLevel !== undefined && s.batteryLevel < 0.3 && !s.charging)
  ) {
    return "lite";
  }
  return "full";
}

type NavigatorSignals = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
    addEventListener?: Navigator["addEventListener"];
    removeEventListener?: Navigator["removeEventListener"];
  };
  deviceMemory?: number;
  getBattery?: () => Promise<{
    level: number;
    charging: boolean;
    addEventListener: EventTarget["addEventListener"];
    removeEventListener: EventTarget["removeEventListener"];
  }>;
};

/** SSR-safe, never throws. */
export function readSignals(
  battery?: { level: number; charging: boolean } | null
): FidelitySignals {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as NavigatorSignals;
  try {
    return {
      effectiveType: nav.connection?.effectiveType,
      saveData: nav.connection?.saveData,
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      batteryLevel: battery?.level,
      charging: battery?.charging,
    };
  } catch {
    return {};
  }
}

type TierListener = (tier: FidelityTier) => void;

/**
 * Owns the active tier. Candidate tiers from signals are applied only after a
 * hold period (hysteresis); manual override applies immediately. Topic changes
 * are pushed to the client as a diff and are applied synchronously, so two
 * rapid changes cannot interleave.
 */
export class FidelityController {
  private tier: FidelityTier = "full";
  private override: FidelityTier | null = null;
  private pending: { tier: FidelityTier; timer: ReturnType<typeof setTimeout> } | null = null;
  private required = new Map<RealtimeTopic, number>();
  private listeners = new Set<TierListener>();
  private battery: {
    level: number;
    charging: boolean;
    addEventListener: EventTarget["addEventListener"];
    removeEventListener: EventTarget["removeEventListener"];
  } | null = null;
  private teardown: (() => void)[] = [];
  private started = false;

  getTier(): FidelityTier {
    return this.override ?? this.tier;
  }

  getOverride(): FidelityTier | null {
    return this.override;
  }

  onChange(listener: TierListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Topics a currently-visible critical action needs; never dropped by a downgrade. */
  requireTopic(topic: RealtimeTopic): () => void {
    this.required.set(topic, (this.required.get(topic) ?? 0) + 1);
    this.applyTopics();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.required.get(topic) ?? 1) - 1;
      if (n <= 0) this.required.delete(topic);
      else this.required.set(topic, n);
      this.applyTopics();
    };
  }

  setOverride(tier: FidelityTier | null): void {
    this.override = tier;
    this.clearPending();
    this.applyTopics();
    this.emit();
  }

  /** Feed new signals; applies the resulting tier after the hysteresis hold. */
  evaluate(signals: FidelitySignals): void {
    const candidate = selectTier(signals);
    if (candidate === this.tier) return this.clearPending();
    if (this.pending?.tier === candidate) return;
    this.clearPending();
    const downgrade = TIER_ORDER.indexOf(candidate) > TIER_ORDER.indexOf(this.tier);
    this.pending = {
      tier: candidate,
      timer: setTimeout(
        () => {
          this.pending = null;
          this.tier = candidate;
          this.applyTopics();
          this.emit();
        },
        downgrade ? DOWNGRADE_HOLD_MS : UPGRADE_HOLD_MS
      ),
    };
  }

  start(): () => void {
    if (this.started || typeof navigator === "undefined") return () => {};
    this.started = true;
    const nav = navigator as NavigatorSignals;
    const reevaluate = () => this.evaluate(readSignals(this.battery));
    const conn = nav.connection;
    conn?.addEventListener?.("change", reevaluate);
    this.teardown.push(() => conn?.removeEventListener?.("change", reevaluate));
    // Re-assert the topic set on every (re)connect; the client also re-sends it.
    this.teardown.push(realtimeClient.onConnectionChange(() => this.applyTopics()));
    try {
      void nav
        .getBattery?.()
        .then((b) => {
          if (!this.started) return;
          this.battery = b;
          b.addEventListener("levelchange", reevaluate);
          b.addEventListener("chargingchange", reevaluate);
          this.teardown.push(() => {
            b.removeEventListener("levelchange", reevaluate);
            b.removeEventListener("chargingchange", reevaluate);
          });
          reevaluate();
        })
        .catch(() => {});
    } catch {
      // Battery API unavailable — assume unconstrained.
    }
    reevaluate();
    return () => this.stop();
  }

  stop(): void {
    this.started = false;
    this.clearPending();
    this.teardown.forEach((fn) => fn());
    this.teardown = [];
    this.battery = null;
  }

  private clearPending(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private applyTopics(): void {
    const profile = FIDELITY_PROFILES[this.getTier()];
    const topics = new Set<string>(profile.transport === "websocket" ? profile.topics : []);
    this.required.forEach((_, t) => topics.add(t));
    realtimeClient.syncTopics(topics);
  }

  private emit(): void {
    const tier = this.getTier();
    this.listeners.forEach((l) => l(tier));
  }
}

export const fidelityController = new FidelityController();
