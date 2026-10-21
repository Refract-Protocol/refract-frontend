export type OptimisticActionKind = "buy" | "provide" | "withdraw";
export interface OptimisticEvent {
  correlationId: string;
  outcome: "confirmed" | "amended" | "rejected";
  reason?: string;
  authoritative?: Record<string, unknown>;
}
interface PendingAction {
  kind: OptimisticActionKind;
  onConfirm: (authoritative?: Record<string, unknown>) => void;
  onRollback: (reason: string) => void;
  onUnverified?: () => void;
  verify: () => Promise<"confirmed" | "rejected" | "pending">;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingAction>();
const resolved = new Map<string, number>();
const TIMEOUT_MS = 90_000;
const RESOLVED_TTL_MS = 10 * 60_000;

function rememberResolved(id: string) {
  resolved.set(id, Date.now() + RESOLVED_TTL_MS);
  for (const [key, expiry] of resolved) if (expiry < Date.now()) resolved.delete(key);
}

export function registerOptimisticAction(input: {
  correlationId: string;
  kind: OptimisticActionKind;
  onConfirm: (authoritative?: Record<string, unknown>) => void;
  onRollback: (reason: string) => void;
  onUnverified?: () => void;
  verify: () => Promise<"confirmed" | "rejected" | "pending">;
}): () => void {
  const previous = pending.get(input.correlationId);
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(async () => {
    const current = pending.get(input.correlationId);
    if (!current) return;
    try {
      const result = await current.verify();
      if (result === "confirmed")
        resolveOptimisticAction({ correlationId: input.correlationId, outcome: "confirmed" });
      else if (result === "rejected")
        resolveOptimisticAction({
          correlationId: input.correlationId,
          outcome: "rejected",
          reason: "The server rejected this action.",
        });
      else {
        pending.delete(input.correlationId);
        rememberResolved(input.correlationId);
        current.onUnverified?.();
      }
    } catch {
      pending.delete(input.correlationId);
      rememberResolved(input.correlationId);
      current.onUnverified?.();
    }
  }, TIMEOUT_MS);
  pending.set(input.correlationId, { ...input, timer });
  return () => {
    const current = pending.get(input.correlationId);
    if (current?.timer === timer) {
      clearTimeout(timer);
      pending.delete(input.correlationId);
    }
  };
}

export function resolveOptimisticAction(event: OptimisticEvent): boolean {
  if (!event.correlationId || resolved.has(event.correlationId)) return false;
  const action = pending.get(event.correlationId);
  if (!action) return false;
  clearTimeout(action.timer);
  pending.delete(event.correlationId);
  rememberResolved(event.correlationId);
  if (event.outcome === "rejected")
    action.onRollback(event.reason || "The action could not be confirmed.");
  else action.onConfirm(event.authoritative);
  return true;
}

export function parseOptimisticEvent(value: unknown): OptimisticEvent | null {
  const outer = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const record =
    outer?.event && typeof outer.event === "object"
      ? (outer.event as Record<string, unknown>)
      : outer;
  if (!record || typeof record.correlationId !== "string") return null;
  const outcome = record.outcome ?? record.status;
  if (outcome !== "confirmed" && outcome !== "amended" && outcome !== "rejected") return null;
  return {
    correlationId: record.correlationId,
    outcome,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    authoritative:
      record.authoritative && typeof record.authoritative === "object"
        ? (record.authoritative as Record<string, unknown>)
        : undefined,
  };
}
