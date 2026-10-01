import type { BuyPolicyParams } from "@/lib/api/policies";
import { TxNotConfirmedError } from "@/lib/wallet/signAndSubmit";

/**
 * - queued: waiting to be checked out (or re-queued by a retry)
 * - processing: being built/signed/submitted right now
 * - confirmed: landed on-chain (or simulated, when `demo`)
 * - failed: rejected before anything reached the chain — safe to retry
 * - unconfirmed: submitted (or interrupted mid-flight) without a confirmation
 *   read. It may still have landed, so it's never retried automatically —
 *   that would risk charging the premium twice.
 * - skipped: left out of the batch by the user
 */
export type CartItemStatus = "queued" | "processing" | "confirmed" | "failed" | "unconfirmed" | "skipped";

export interface CartItem {
  id: string;
  params: Omit<BuyPolicyParams, "holder">;
  typeName: string;
  icon: string;
  premium: number;
  status: CartItemStatus;
  policyId?: string;
  txHash?: string;
  demo?: boolean;
  error?: string;
}

export interface PurchaseResult {
  policyId: string;
  txHash?: string;
  demo: boolean;
}

export type CartItemPatch = Partial<Omit<CartItem, "id" | "params">>;

/**
 * Checks out every queued item one at a time — Freighter/Soroban has no
 * generic atomic multi-call, so each purchase is its own sign-and-submit.
 * A failing item never stops the batch; it's marked and the loop moves on,
 * leaving the user to retry or skip it afterwards.
 */
export async function runBatchCheckout(
  items: CartItem[],
  purchase: (item: CartItem) => Promise<PurchaseResult>,
  update: (id: string, patch: CartItemPatch) => void
): Promise<void> {
  for (const item of items) {
    if (item.status !== "queued") continue;
    update(item.id, { status: "processing", error: undefined });
    try {
      const { policyId, txHash, demo } = await purchase(item);
      update(item.id, { status: "confirmed", policyId, txHash, demo });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Something went wrong buying coverage";
      if (err instanceof TxNotConfirmedError) {
        update(item.id, { status: "unconfirmed", txHash: err.txHash, error });
      } else {
        update(item.id, { status: "failed", error });
      }
    }
  }
}

/** Re-queues a failed item. Unconfirmed items are deliberately not retryable. */
export function retryItem(item: CartItem): CartItem {
  return item.status === "failed" ? { ...item, status: "queued", error: undefined } : item;
}

export function skipItem(item: CartItem): CartItem {
  return item.status === "failed" || item.status === "queued" ? { ...item, status: "skipped" } : item;
}

/**
 * Restores a cart persisted before a reload/navigation. Anything that was
 * mid-flight may already have been submitted, so it comes back as
 * unconfirmed rather than queued.
 */
export function restoreCart(raw: string | null): CartItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CartItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) =>
      item.status === "processing"
        ? { ...item, status: "unconfirmed", error: "Checkout was interrupted — check your Dashboard before buying this again." }
        : item
    );
  } catch {
    return [];
  }
}
