import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { ACTIVE_NETWORK } from "@/lib/network";
import type { PoolStats } from "@/lib/api/pool";

/**
 * Client-side Soroban RPC reads of the pool contract's view functions: the
 * second-tier fallback (backend API -> direct chain read -> fixture).
 *
 * Contract id comes from NEXT_PUBLIC_POOL_CONTRACT_ID; with it unset every
 * read rejects with ChainReadUnavailableError and callers drop to fixtures.
 *
 * View-function names below are assumptions to verify against the pool
 * contract. No transaction is ever signed or sent: reads use `simulateTransaction`.
 */
export const POOL_CONTRACT_ID = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID ?? "";

export const POOL_VIEW_FNS = {
  totalUsdc: "total_usdc",
  totalShares: "total_shares",
  lockedUsdc: "locked_usdc",
  premiumAccrued: "premium_accrued",
  maxUtilizationBps: "max_utilization_bps",
  minCoverage: "min_coverage",
  maxCoverage: "max_coverage",
  lockupExpiresAt: "lockup_expires_at",
} as const;

export class ChainReadUnavailableError extends Error {
  constructor(message = "Direct chain read is unavailable") {
    super(message);
    this.name = "ChainReadUnavailableError";
  }
}

// A well-known, always-valid zero account: simulation needs a source but never signs.
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Invokes a read-only contract function via Soroban RPC simulation and returns its native-decoded result. */
export async function readContract(
  method: string,
  args: xdr.ScVal[] = [],
  signal?: AbortSignal,
  contractId: string = POOL_CONTRACT_ID
): Promise<unknown> {
  if (!contractId) throw new ChainReadUnavailableError("No pool contract configured");
  const server = new rpc.Server(ACTIVE_NETWORK.rpcUrl);
  const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: ACTIVE_NETWORK.networkPassphrase ?? Networks.TESTNET,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new ChainReadUnavailableError(`Simulation of ${method} failed`);
  }
  return scValToNative(sim.result.retval);
}

const asString = (v: unknown): string => String(v ?? 0);

/**
 * Pool stats derivable from chain state. `apyBps` is backend-computed (needs
 * historical premium accrual) so it can't be read on-chain and is returned as
 * 0 — callers must treat it as unavailable for the "chain" tier.
 */
export async function readPoolStats(signal?: AbortSignal): Promise<PoolStats> {
  const [totalUsdc, totalShares, lockedUsdc, premiumAccrued, maxUtilizationBps] = await Promise.all([
    readContract(POOL_VIEW_FNS.totalUsdc, [], signal),
    readContract(POOL_VIEW_FNS.totalShares, [], signal),
    readContract(POOL_VIEW_FNS.lockedUsdc, [], signal),
    readContract(POOL_VIEW_FNS.premiumAccrued, [], signal),
    readContract(POOL_VIEW_FNS.maxUtilizationBps, [], signal),
  ]);
  const total = BigInt(asString(totalUsdc));
  const shares = BigInt(asString(totalShares));
  const locked = BigInt(asString(lockedUsdc));
  return {
    totalUsdc: total.toString(),
    totalShares: shares.toString(),
    lockedUsdc: locked.toString(),
    premiumAccrued: asString(premiumAccrued),
    availableUsdc: (total - locked).toString(),
    utilizationBps: total > BigInt(0) ? Number((locked * BigInt(10_000)) / total) : 0,
    apyBps: 0,
    sharePrice: shares > BigInt(0) ? Number(total) / Number(shares) : 1,
    maxUtilizationBps: Number(maxUtilizationBps),
  };
}

export async function readCoverageBounds(
  signal?: AbortSignal
): Promise<{ minCoverage: string | null; maxCoverage: string | null }> {
  const [min, max] = await Promise.all([
    readContract(POOL_VIEW_FNS.minCoverage, [], signal),
    readContract(POOL_VIEW_FNS.maxCoverage, [], signal),
  ]);
  return { minCoverage: min == null ? null : asString(min), maxCoverage: max == null ? null : asString(max) };
}

/** Unix seconds the address's lockup ends, as a string, or null if it never deposited. */
export async function readLockupStatus(
  address: string,
  signal?: AbortSignal
): Promise<{ lockupExpiresAt: string | null }> {
  const v = await readContract(
    POOL_VIEW_FNS.lockupExpiresAt,
    [nativeToScVal(new Address(address), { type: "address" })],
    signal
  );
  return { lockupExpiresAt: v == null || String(v) === "0" ? null : asString(v) };
}
