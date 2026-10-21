import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PolicyEvent } from "./policyEvents";

/**
 * Pending policy purchases and how realtime events move them along
 * (issue #246).
 *
 *   submitted ──accepted──▶ accepted ──issued──▶ active
 *        │                      │                  │
 *        └──────failed──────────┴──▶ failed        └──cancelled──▶ cancelled
 *
 * The REST purchase call creates the optimistic entry (keyed by its tx hash);
 * events only move it forward. If no event arrives within
 * `PENDING_WAIT_MS`, the REST result stands and the entry settles as active
 * with `confirmedBy: "rest"`.
 *
 * The list is persisted in localStorage so a pending purchase survives
 * navigating away from /cover, and the `storage` event keeps other tabs in
 * sync (see `usePolicyStream`).
 */

export type PendingPolicyStatus = "submitted" | "accepted" | "active" | "failed" | "cancelled";

export interface PendingPolicy {
  /** Stable identity: the purchase tx hash, or `policy:<id>` for policies we only know by id. */
  key: string;
  txHash?: string;
  policyId?: string;
  holder: string;
  status: PendingPolicyStatus;
  coverageType?: number;
  coverageTypeName?: string;
  /** Base-unit USDC string. */
  coverageAmount?: string;
  /** Base-unit USDC string. */
  premium?: string;
  /** Base-unit USDC string, from the latest `premium_charged` event. */
  premiumCharged?: string;
  /** What moved this entry to `active`. */
  confirmedBy?: "realtime" | "rest";
  /** Failure or cancellation reason. */
  reason?: string;
  /** True for policies first seen through an event (bought elsewhere). */
  external?: boolean;
  /** Client ms when the entry was created. */
  createdAt: number;
  /** Client ms of the last change. */
  updatedAt: number;
  /** Server ms (`ts`) of the last applied event. Normalize before display. */
  lastEventTs?: number;
}

/** How long to wait for a realtime event before trusting the REST result. */
export const PENDING_WAIT_MS = 90_000;
/** Settled entries older than this are pruned. */
export const SETTLED_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_PENDING_ENTRIES = 20;

const RANK: Record<PendingPolicyStatus, number> = {
  submitted: 0,
  accepted: 1,
  active: 2,
  failed: 3,
  cancelled: 3,
};

export function isTerminal(status: PendingPolicyStatus): boolean {
  return status === "active" || status === "failed" || status === "cancelled";
}

export interface OptimisticPolicyInput {
  txHash: string;
  holder: string;
  policyId?: string;
  coverageType?: number;
  coverageTypeName?: string;
  coverageAmount?: string;
  premium?: string;
}

function findIndex(list: PendingPolicy[], txHash?: string, policyId?: string): number {
  if (txHash) {
    const i = list.findIndex((p) => p.txHash === txHash);
    if (i !== -1) return i;
  }
  if (policyId) return list.findIndex((p) => p.policyId === policyId);
  return -1;
}

function prune(list: PendingPolicy[], now: number): PendingPolicy[] {
  return list
    .filter((p) => !isTerminal(p.status) || now - p.updatedAt < SETTLED_RETENTION_MS)
    .slice(0, MAX_PENDING_ENTRIES);
}

/**
 * Adds the optimistic entry for a just-submitted purchase. Idempotent: a
 * second call for the same tx hash (another tab, a retry, an event that
 * arrived first) merges into the existing row instead of duplicating it.
 */
export function addOptimistic(
  list: PendingPolicy[],
  input: OptimisticPolicyInput,
  now: number
): PendingPolicy[] {
  const existing = list[findIndex(list, input.txHash, input.policyId)];
  if (existing) {
    // Keep what events already established; fill gaps from the REST result.
    const known = Object.fromEntries(
      Object.entries(existing).filter(([, v]) => v !== undefined)
    ) as PendingPolicy;
    const merged: PendingPolicy = {
      ...input,
      ...known,
      txHash: input.txHash,
      policyId: existing.policyId ?? input.policyId,
      external: false,
    };
    return list.map((p) => (p === existing ? merged : p));
  }
  const entry: PendingPolicy = {
    ...input,
    key: input.txHash,
    status: "submitted",
    createdAt: now,
    updatedAt: now,
  };
  return prune([entry, ...list], now);
}

/**
 * Applies one realtime event. Events never move an entry backwards, so
 * duplicates and out-of-order delivery are harmless.
 */
export function applyPolicyEvent(
  list: PendingPolicy[],
  event: PolicyEvent,
  now: number
): PendingPolicy[] {
  const prev = list[findIndex(list, "txHash" in event ? event.txHash : undefined, event.policyId)];

  if (!prev) {
    // Policies bought outside this session (another device, a direct contract
    // call) still appear. Events about unknown policies that don't create one
    // have nothing to update.
    if (event.type !== "issued" && event.type !== "accepted") return list;
    const created: PendingPolicy = {
      key: event.txHash,
      txHash: event.txHash,
      policyId: event.policyId,
      holder: event.holder,
      status: event.type === "issued" ? "active" : "accepted",
      ...(event.type === "issued"
        ? {
            confirmedBy: "realtime" as const,
            coverageTypeName: event.coverageTypeName,
            coverageAmount: event.coverageAmount,
            premium: event.premium,
          }
        : {}),
      external: true,
      createdAt: now,
      updatedAt: now,
      lastEventTs: event.ts,
    };
    return prune([created, ...list], now);
  }

  let next: PendingPolicy = prev;
  const advance = (status: PendingPolicyStatus, patch: Partial<PendingPolicy> = {}) => {
    if (RANK[status] > RANK[prev.status]) next = { ...prev, ...patch, status };
  };

  switch (event.type) {
    case "accepted":
      advance("accepted", { policyId: prev.policyId ?? event.policyId });
      break;
    case "issued":
      advance("active", {
        policyId: event.policyId,
        confirmedBy: "realtime",
        coverageTypeName: event.coverageTypeName ?? prev.coverageTypeName,
        coverageAmount: event.coverageAmount ?? prev.coverageAmount,
        premium: event.premium ?? prev.premium,
      });
      // A REST-settled entry is already active; record that the chain agreed.
      if (prev.status === "active" && prev.confirmedBy === "rest")
        next = { ...prev, confirmedBy: "realtime" };
      break;
    case "failed":
      // Roll back the optimistic entry. Only valid before issuance.
      if (prev.status === "submitted" || prev.status === "accepted")
        next = { ...prev, status: "failed", reason: event.reason };
      break;
    case "cancelled":
      if (prev.status !== "failed" && prev.status !== "cancelled")
        next = { ...prev, status: "cancelled", reason: event.reason };
      break;
    case "premium_charged":
      next = { ...prev, premiumCharged: event.amount };
      break;
  }

  if (next === prev) return list;
  next = { ...next, updatedAt: now, lastEventTs: Math.max(prev.lastEventTs ?? 0, event.ts) };
  return list.map((p) => (p === prev ? next : p));
}

/**
 * Bounded-wait fallback: no event arrived in time, so trust the REST result
 * (the transaction was submitted successfully) and mark the entry active.
 */
export function settleViaRest(list: PendingPolicy[], key: string, now: number): PendingPolicy[] {
  return list.map((p) =>
    p.key === key && (p.status === "submitted" || p.status === "accepted")
      ? { ...p, status: "active", confirmedBy: "rest", updatedAt: now }
      : p
  );
}

/**
 * An in-flight purchase with the same parameters, if any. Used to warn
 * before a duplicate submission (including from another tab).
 */
export function findInFlightDuplicate(
  list: PendingPolicy[],
  params: { holder: string; coverageType: number; coverageAmount: string }
): PendingPolicy | undefined {
  return list.find(
    (p) =>
      !isTerminal(p.status) &&
      p.holder === params.holder &&
      p.coverageType === params.coverageType &&
      p.coverageAmount === params.coverageAmount
  );
}

export const PENDING_POLICIES_STORAGE_KEY = "refract:pending-policies";

interface PendingPolicyStore {
  entries: PendingPolicy[];
  addOptimistic: (input: OptimisticPolicyInput) => void;
  applyEvent: (event: PolicyEvent) => void;
  settleViaRest: (key: string) => void;
  dismiss: (key: string) => void;
}

export const usePendingPolicyStore = create<PendingPolicyStore>()(
  persist(
    (set) => ({
      entries: [],
      addOptimistic: (input) =>
        set((s) => ({ entries: addOptimistic(s.entries, input, Date.now()) })),
      applyEvent: (event) =>
        set((s) => ({ entries: applyPolicyEvent(s.entries, event, Date.now()) })),
      settleViaRest: (key) => set((s) => ({ entries: settleViaRest(s.entries, key, Date.now()) })),
      dismiss: (key) => set((s) => ({ entries: s.entries.filter((p) => p.key !== key) })),
    }),
    {
      name: PENDING_POLICIES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ entries: s.entries }),
    }
  )
);
