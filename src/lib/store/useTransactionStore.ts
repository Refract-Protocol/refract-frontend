import { create } from "zustand";

export type TransactionType = "buy" | "provide" | "withdraw";
export type TransactionStatus = "pending" | "signing" | "confirmed" | "failed";

export interface TransactionEntry {
  id: string;
  type: TransactionType;
  /** Human-readable USDC amount. */
  amount: number;
  status: TransactionStatus;
  /** ms since epoch when the attempt started. */
  timestamp: number;
  txHash?: string;
  error?: string;
  /** Simulated client-side because the API was unreachable. */
  demo?: boolean;
}

/** Oldest entries are evicted past this many so a long session can't grow unbounded. */
export const MAX_TRANSACTIONS = 20;

interface TransactionStore {
  /** Newest first. */
  transactions: TransactionEntry[];
  /** Records a new attempt in `pending` state and returns its id. */
  addTransaction: (tx: { type: TransactionType; amount: number }) => string;
  updateTransaction: (id: string, patch: Partial<Omit<TransactionEntry, "id" | "type" | "timestamp">>) => void;
  clear: () => void;
}

/** Session-scoped (in-memory) record of buy/provide/withdraw attempts, shared across pages. */
export const useTransactionStore = create<TransactionStore>((set) => ({
  transactions: [],
  addTransaction: ({ type, amount }) => {
    const id = crypto.randomUUID();
    set((s) => ({
      transactions: [{ id, type, amount, status: "pending" as const, timestamp: Date.now() }, ...s.transactions].slice(
        0,
        MAX_TRANSACTIONS
      ),
    }));
    return id;
  },
  updateTransaction: (id, patch) =>
    set((s) => ({ transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  clear: () => set({ transactions: [] }),
}));
