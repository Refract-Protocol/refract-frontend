const STORAGE_KEY = "refract:pendingTx";

export type PendingTxKind = "buy" | "provide" | "withdraw";

export interface PendingTxRecord {
  version: 1;
  signedXdr: string;
  kind: PendingTxKind;
  submittedAt: number;
}

/**
 * A minimal record of a transaction that's already been signed but hadn't
 * confirmed yet when it was persisted — so a refresh mid-submission doesn't
 * silently lose track of it.
 */
export function savePendingTx(record: Omit<PendingTxRecord, "version">): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...record }));
  } catch {
    // localStorage unavailable (private mode, etc.) — nothing to recover, not fatal.
  }
}

export function getPendingTx(): PendingTxRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingTxRecord;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingTx(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
