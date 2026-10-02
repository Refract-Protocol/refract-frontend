import { ACTIVE_NETWORK } from "@/lib/network";

/**
 * Minimal client-side Horizon reader for a wallet's Refract activity.
 *
 * Endpoint: GET {horizonUrl}/accounts/{address}/operations (public SDF Horizon,
 * see src/lib/network.ts). SDF's public Horizon is rate-limited per IP
 * (~3600 req/hour), so requests are paged with Horizon's own `cursor` rather
 * than fetched all at once, and 429/5xx responses are retried with backoff.
 */

/** Refract contract IDs (C…) to filter on. When none are configured every Soroban invocation is shown. */
export const REFRACT_CONTRACT_IDS = [
  process.env.NEXT_PUBLIC_POOL_CONTRACT_ID,
  process.env.NEXT_PUBLIC_POLICY_CONTRACT_ID,
].filter((id): id is string => Boolean(id));

export interface HorizonOperation {
  id: string;
  paging_token: string;
  type: string;
  created_at: string;
  transaction_hash: string;
  transaction_successful?: boolean;
  function?: string;
  parameters?: { type: string; value: string }[];
  asset_balance_changes?: {
    asset_type: string;
    asset_code?: string;
    from?: string;
    to?: string;
    amount: string;
    type: string;
  }[];
}

interface HorizonPage {
  _links: { next?: { href: string } };
  _embedded: { records: HorizonOperation[] };
}

export interface HistoryEntry {
  id: string;
  txHash: string;
  timestamp: string;
  contractId: string | null;
  /** Contract function invoked, e.g. "buy_policy" / "deposit". */
  operation: string;
  /** Decoded amount moved (human units) and asset code, when Horizon reports a balance change. */
  amount: number | null;
  asset: string | null;
  successful: boolean;
}

// --- tiny XDR/strkey helpers (avoids pulling in @stellar/stellar-sdk) ---

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readU32(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function crc16xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Encodes a 32-byte contract hash as a `C…` strkey. */
export function contractStrkey(hash: Uint8Array): string {
  const payload = new Uint8Array(33);
  payload[0] = 2 << 3; // contract version byte
  payload.set(hash, 1);
  const crc = crc16xmodem(payload);
  const full = new Uint8Array(35);
  full.set(payload);
  full[33] = crc & 0xff;
  full[34] = crc >> 8;
  return base32(full);
}

/** Decodes a base64 ScVal Address pointing at a contract; null for anything else. */
export function decodeContractAddress(b64: string): string | null {
  const b = base64ToBytes(b64);
  // ScVal type SCV_ADDRESS (18), ScAddress type CONTRACT (1), 32-byte hash
  if (b.length < 40 || readU32(b, 0) !== 18 || readU32(b, 4) !== 1) return null;
  return contractStrkey(b.slice(8, 40));
}

/** Decodes a base64 ScVal Symbol; null for anything else. */
export function decodeSymbol(b64: string): string | null {
  const b = base64ToBytes(b64);
  if (b.length < 8 || readU32(b, 0) !== 15) return null;
  const len = readU32(b, 4);
  return new TextDecoder().decode(b.slice(8, 8 + len));
}

// --- parsing ---

/** Turns raw Horizon operations into history rows, keeping only Refract contract invocations. */
export function parseOperations(records: HorizonOperation[], contractIds: string[] = REFRACT_CONTRACT_IDS): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const op of records) {
    if (op.type !== "invoke_host_function") continue;
    const [contractParam, fnParam] = op.parameters ?? [];
    const contractId = contractParam ? decodeContractAddress(contractParam.value) : null;
    if (contractIds.length > 0 && (!contractId || !contractIds.includes(contractId))) continue;

    const change = op.asset_balance_changes?.[0];
    entries.push({
      id: op.id,
      txHash: op.transaction_hash,
      timestamp: op.created_at,
      contractId,
      operation: (fnParam && decodeSymbol(fnParam.value)) ?? "contract_call",
      amount: change ? Number(change.amount) : null,
      asset: change ? (change.asset_code ?? (change.asset_type === "native" ? "XLM" : change.asset_type)) : null,
      successful: op.transaction_successful ?? true,
    });
  }
  return entries;
}

export class HorizonError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "HorizonError";
  }
}

const MAX_RETRIES = 3;

async function fetchWithBackoff(url: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal });
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new HorizonError(
        res.status === 429 ? "Horizon rate limit reached — try again shortly" : `Horizon request failed (${res.status})`,
        res.status
      );
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, delay));
  }
}

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Cursor for the next (older) page, or null when history is exhausted. */
  nextCursor: string | null;
}

/** Fetches one page (newest first) of the account's operations and filters to Refract activity. */
export async function fetchHistoryPage(
  address: string,
  cursor: string | null,
  signal?: AbortSignal,
  limit = 50
): Promise<HistoryPage> {
  const params = new URLSearchParams({ order: "desc", limit: String(limit), join: "transactions" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetchWithBackoff(`${ACTIVE_NETWORK.horizonUrl}/accounts/${address}/operations?${params}`, signal);
  const page = (await res.json()) as HorizonPage;
  const records = page._embedded.records;
  return {
    entries: parseOperations(records),
    nextCursor: records.length < limit ? null : records[records.length - 1].paging_token,
  };
}
