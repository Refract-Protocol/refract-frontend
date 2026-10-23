import type { StellarNetworkId } from "@/lib/network";

export interface SorobanEventsOptions {
  networkId: StellarNetworkId;
  rpcUrl: string;
  /** Map of contract ID -> short kind used in the topic name (e.g. "policy"). Empty → no-op. */
  contracts: Record<string, string>;
  publish: (topic: string, payload: unknown, source?: string) => void;
  pollMs?: number;
  fetchImpl?: typeof fetch;
  random?: () => number;
}

interface RpcEvent {
  id: string;
  ledger: number;
  contractId: string;
  topic: unknown[];
  value: unknown;
  txHash?: string;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const SEEN_LIMIT = 500;

class RpcHttpError extends Error {
  constructor(readonly status: number) {
    super(`Soroban RPC HTTP ${status}`);
  }
}

/**
 * Tails Soroban RPC `getEvents` per contract and republishes each event on
 * `contract_events:<kind>`. Cursors live in memory, keyed by network+contract.
 * Returns a stop function; with no contracts configured it is a no-op.
 *
 * Retention: RPC only keeps a bounded ledger window. If the checkpoint falls
 * behind `oldestLedger` (or RPC rejects the cursor) we restart from the latest
 * ledger and publish `{ type: "resync" }` so consumers can refetch.
 */
export function startSorobanEvents(opts: SorobanEventsOptions): () => void {
  const ids = Object.keys(opts.contracts).filter(Boolean);
  if (ids.length === 0) return () => {};

  const {
    networkId,
    rpcUrl,
    contracts,
    publish,
    pollMs = 5_000,
    fetchImpl = fetch,
    random = Math.random,
  } = opts;
  const cursors = new Map<string, { cursor?: string; ledger?: number }>();
  const seen = new Set<string>();
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const rpc = async <T>(method: string, params?: unknown): Promise<T> => {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new RpcHttpError(res.status);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error || !body.result) throw new Error(body.error?.message ?? "Empty RPC result");
    return body.result;
  };

  const resync = async (key: string, contractId: string) => {
    const { sequence } = await rpc<{ sequence: number }>("getLatestLedger");
    cursors.set(key, { ledger: sequence });
    publish(
      `contract_events:${contracts[contractId]}`,
      { type: "resync", contractId, ledger: sequence },
      "soroban"
    );
  };

  const pollContract = async (contractId: string) => {
    const key = `${networkId}:${contractId}`;
    const state = cursors.get(key);
    if (!state) {
      const { sequence } = await rpc<{ sequence: number }>("getLatestLedger");
      cursors.set(key, { ledger: sequence });
      return;
    }
    const pagination = state.cursor ? { cursor: state.cursor, limit: 100 } : { limit: 100 };
    let result: {
      events: RpcEvent[];
      cursor?: string;
      oldestLedger?: number;
      latestLedger?: number;
    };
    try {
      result = await rpc("getEvents", {
        ...(state.cursor ? {} : { startLedger: state.ledger }),
        filters: [{ type: "contract", contractIds: [contractId] }],
        pagination,
      });
    } catch (err) {
      if (err instanceof RpcHttpError) throw err;
      return resync(key, contractId); // cursor/startLedger fell out of retention
    }
    if (
      result.oldestLedger !== undefined &&
      state.ledger !== undefined &&
      state.ledger < result.oldestLedger
    ) {
      return resync(key, contractId);
    }
    for (const ev of result.events) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
      publish(
        `contract_events:${contracts[contractId]}`,
        {
          type: "contract_event",
          contractId,
          ledger: ev.ledger,
          eventId: ev.id,
          topic: ev.topic,
          value: ev.value,
          txHash: ev.txHash,
        },
        "soroban"
      );
    }
    cursors.set(key, {
      cursor: result.cursor ?? state.cursor,
      ledger: result.latestLedger ?? state.ledger,
    });
  };

  const tick = async () => {
    if (stopped) return;
    let retryable = false;
    for (const id of ids) {
      try {
        await pollContract(id);
      } catch (err) {
        retryable ||= err instanceof RpcHttpError ? err.status === 429 || err.status >= 500 : true;
      }
    }
    failures = retryable ? failures + 1 : 0;
    const delay = failures
      ? Math.min(BASE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS) * (0.5 + random() * 0.5)
      : pollMs;
    if (!stopped) timer = setTimeout(tick, delay);
  };

  timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    cursors.clear();
  };
}
