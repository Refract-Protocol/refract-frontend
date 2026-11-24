/**
 * Stellar Federation Protocol (SEP-0002) resolution: turns `name*domain.com`
 * into the `G...` account it points to by reading the domain's
 * `/.well-known/stellar.toml` for `FEDERATION_SERVER`, then querying that
 * server with `?q=<address>&type=name`.
 */

export const FEDERATION_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// In-memory cache for resolved federation addresses
// ---------------------------------------------------------------------------
// Keyed by the original federation address string (e.g. "alice*domain.com").
// Only successful resolutions are cached; failed lookups are never stored so
// transient network errors are always retried on the next call.
// TTL is 5 minutes — long enough to avoid per-keystroke round-trips while
// short enough that stale federation data does not persist indefinitely.

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  accountId: string;
  expiresAt: number;
}

const federationCache = new Map<string, CacheEntry>();

const PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;
const FEDERATION_RE = /^[^*\s]+\*([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;

/** Whether `value` is shaped like a Stellar account public key (`G` + 55 base32 chars). */
export function isStellarPublicKey(value: string): boolean {
  return PUBLIC_KEY_RE.test(value);
}

/** Whether `value` is shaped like a federation address (`name*domain.tld`). */
export function isFederationAddress(value: string): boolean {
  return FEDERATION_RE.test(value);
}

/** Reads a top-level `FEDERATION_SERVER = "..."` entry from a stellar.toml document. */
export function parseFederationServer(toml: string): string | null {
  const match = toml.match(/^\s*FEDERATION_SERVER\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m);
  if (!match) return null;
  try {
    const url = new URL(match[1]!);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, signal: AbortSignal): Promise<Response> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json, text/plain, */*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/**
 * Resolves `input` to a Stellar public key. A raw `G...` address passes
 * through unchanged; a federation address is looked up (bounded by
 * `FEDERATION_TIMEOUT_MS`). Returns `null` for anything that can't be
 * resolved to a well-formed public key — it never falls back to the raw
 * federation string.
 */
export async function resolveFederationAddress(input: string): Promise<string | null> {
  const value = input.trim();
  if (isStellarPublicKey(value)) return value;

  const match = value.match(FEDERATION_RE);
  if (!match) return null;
  const domain = match[1]!.toLowerCase();

  // Return a cached result if it has not yet expired.
  const cached = federationCache.get(value);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accountId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEDERATION_TIMEOUT_MS);
  try {
    const tomlRes = await fetchWithTimeout(
      `https://${domain}/.well-known/stellar.toml`,
      controller.signal
    );
    const server = parseFederationServer(await tomlRes.text());
    if (!server) return null;

    const url = new URL(server);
    url.searchParams.set("q", value);
    url.searchParams.set("type", "name");
    const body: unknown = await (await fetchWithTimeout(url.toString(), controller.signal)).json();
    const accountId = (body as { account_id?: unknown } | null)?.account_id;
    if (typeof accountId === "string" && isStellarPublicKey(accountId)) {
      // Cache successful resolutions only; failures are not stored so they
      // will be retried on the next call.
      federationCache.set(value, { accountId, expiresAt: Date.now() + CACHE_TTL_MS });
      return accountId;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
