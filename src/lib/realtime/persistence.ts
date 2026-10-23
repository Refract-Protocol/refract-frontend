/**
 * Session-storage persistence for active realtime topic subscriptions.
 *
 * Persists the set of active subscriptions (topic, scope, last cursor) so a
 * reload or route navigation can rehydrate cursors instead of forcing a cold
 * full-data refetch. Payloads are versioned so future contract changes
 * invalidate cleanly, and reads are validated against the runtime schema
 * parser before being trusted.
 */

const STORAGE_NAMESPACE = 'handsoff:realtime:subscriptions';
const SCHEMA_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;

export interface PersistedSubscription {
  topic: string;
  scope: string;
  cursor: string | null;
}

interface PersistedPayload {
  version: number;
  subscriptions: PersistedSubscription[];
}

/**
 * Runtime schema parser for a persisted subscription entry. Returns a
 * normalized entry or null when the shape is invalid.
 */
export function parsePersistedSubscription(
  value: unknown,
): PersistedSubscription | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const { topic, scope, cursor } = record;
  if (typeof topic !== 'string' || topic.length === 0) return null;
  if (typeof scope !== 'string' || scope.length === 0) return null;
  if (cursor !== null && typeof cursor !== 'string') return null;
  const boundedCursor =
    typeof cursor === 'string' && cursor.length > MAX_CURSOR_LENGTH
      ? cursor.slice(0, MAX_CURSOR_LENGTH)
      : cursor;
  return { topic, scope, cursor: boundedCursor };
}

function storageKey(wallet: string, scope: string): string {
  return `${STORAGE_NAMESPACE}:${wallet}:${scope}`;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Persist the active subscriptions for a wallet/scope pair. No-op during SSR
 * or when session storage is unavailable.
 */
export function persistSubscriptions(
  wallet: string,
  scope: string,
  subscriptions: PersistedSubscription[],
): void {
  const storage = getStorage();
  if (!storage) return;
  const payload: PersistedPayload = {
    version: SCHEMA_VERSION,
    subscriptions: subscriptions
      .map((entry) => parsePersistedSubscription(entry))
      .filter((entry): entry is PersistedSubscription => entry !== null),
  };
  try {
    storage.setItem(storageKey(wallet, scope), JSON.stringify(payload));
  } catch {
    // Storage may be full or disabled; persistence is best-effort.
  }
}

/**
 * Read persisted subscriptions for a wallet/scope pair, reconciling against
 * the known topic contract. Unknown topics and stale entries are dropped.
 * Corrupted or foreign JSON is handled gracefully by returning an empty list.
 */
export function readPersistedSubscriptions(
  wallet: string,
  scope: string,
  knownTopics: ReadonlySet<string>,
): PersistedSubscription[] {
  const storage = getStorage();
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(wallet, scope));
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const payload = parsed as Record<string, unknown>;
  if (payload.version !== SCHEMA_VERSION) return [];
  if (!Array.isArray(payload.subscriptions)) return [];

  const reconciled: PersistedSubscription[] = [];
  const seen = new Set<string>();
  for (const entry of payload.subscriptions) {
    const subscription = parsePersistedSubscription(entry);
    if (!subscription) continue;
    if (!knownTopics.has(subscription.topic)) continue;
    if (seen.has(subscription.topic)) continue;
    seen.add(subscription.topic);
    reconciled.push(subscription);
  }
  return reconciled;
}

/**
 * Clear persisted subscriptions for a wallet/scope pair. Used on explicit
 * logout or network/scope change.
 */
export function clearPersistedSubscriptions(
  wallet: string,
  scope: string,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(wallet, scope));
  } catch {
    // Best-effort cleanup.
  }
}
