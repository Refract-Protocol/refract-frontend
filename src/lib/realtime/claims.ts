import type { ClaimRecord } from "@/lib/api/claims";

export type StreamClaim = ClaimRecord & {
  id?: string;
  claimId?: string;
  status?: string;
  dedupKey?: string;
};

function normalizeClaim(value: unknown, fallbackStatus: string): StreamClaim | null {
  const candidate = value;
  if (!candidate || typeof candidate !== "object") return null;
  const row = candidate as Record<string, unknown>;
  const policyId = String(row.policyId ?? row.policy_id ?? "");
  if (!policyId) return null;
  const processedAt = Number(
    row.processedAt ?? row.processed_at ?? row.settledAt ?? row.timestamp ?? Date.now() / 1000
  );
  const payout = row.payout == null ? "0" : String(row.payout);
  return {
    policyId,
    holder: String(row.holder ?? row.wallet ?? ""),
    coverageType: Number(row.coverageType ?? row.coverage_type ?? 0),
    triggered: row.triggered !== false,
    payout,
    reason: String(row.reason ?? "Claim settled"),
    processedAt: Number.isFinite(processedAt) ? processedAt : Date.now() / 1000,
    settlementTxHash:
      typeof (row.settlementTxHash ?? row.settlement_tx_hash) === "string"
        ? String(row.settlementTxHash ?? row.settlement_tx_hash)
        : undefined,
    id: typeof (row.claimId ?? row.id) === "string" ? String(row.claimId ?? row.id) : undefined,
    claimId: typeof row.claimId === "string" ? row.claimId : undefined,
    status: typeof row.status === "string" ? row.status : fallbackStatus,
    dedupKey: typeof row.dedupKey === "string" ? row.dedupKey : undefined,
  };
}

export function normalizeRestClaim(value: ClaimRecord): StreamClaim {
  return normalizeClaim(value, value.triggered ? "settled" : "pending") ?? value;
}

export function normalizeClaimFrame(value: unknown): StreamClaim | null {
  const outer = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const candidate = outer?.claim && typeof outer.claim === "object" ? outer.claim : value;
  const normalized = normalizeClaim(candidate, "settled");
  if (!normalized) return null;
  if (typeof outer?.dedupKey === "string") normalized.dedupKey = outer.dedupKey;
  return normalized;
}

export function claimKey(claim: StreamClaim): string {
  return claim.dedupKey ?? claim.claimId ?? claim.id ?? claim.settlementTxHash ?? claim.policyId;
}

const terminal = new Set(["settled", "paid", "rejected", "failed", "cancelled"]);

/** Reconcile pushed rows with REST rows while keeping the REST order and page buffer. */
export function mergeClaims(
  rest: StreamClaim[],
  pushed: StreamClaim[],
  limit = Number.POSITIVE_INFINITY
): StreamClaim[] {
  const merged = new Map<string, StreamClaim>();
  for (const claim of rest) merged.set(claimKey(claim), claim);
  for (const claim of pushed) {
    const key = claimKey(claim);
    const existing = merged.get(key);
    if (existing) {
      const existingTerminal = terminal.has(
        String(existing.status ?? (existing.triggered ? "settled" : "pending")).toLowerCase()
      );
      const incomingTerminal = terminal.has(
        String(claim.status ?? (claim.triggered ? "settled" : "pending")).toLowerCase()
      );
      const older = Number(claim.processedAt) < Number(existing.processedAt);
      if ((!existingTerminal || incomingTerminal) && (!older || !existingTerminal))
        merged.set(key, { ...existing, ...claim });
    } else merged.set(key, claim);
  }
  return [...merged.values()]
    .sort((a, b) => Number(b.processedAt) - Number(a.processedAt))
    .slice(0, limit);
}
