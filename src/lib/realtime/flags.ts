import { FLAGS_ENDPOINT } from "@/lib/flags/flagsConfig";

/**
 * Per-topic realtime flags.
 *
 * Schema (public/flags.json), keyed by topic identifier:
 *   { "realtime": { "topics": { "<topic>": { "enabled": boolean, "kill"?: boolean } } } }
 *
 * Precedence, highest first:
 *   1. kill (runtime `killTopic()` or `kill: true` in flags.json) — always disabled
 *   2. in-memory override (`setTopicOverride`, used by tests / developer flow)
 *   3. env override NEXT_PUBLIC_REALTIME_TOPICS_OVERRIDE='{"oracle_update":true}'
 *   4. flags.json `enabled`
 *   5. default: disabled (unknown, missing or malformed entries fail closed)
 */
export type TopicFlagListener = (topic: string, enabled: boolean) => void;

interface TopicFlag {
  enabled: boolean;
  kill: boolean;
}

let fileFlags = new Map<string, TopicFlag>();
let envOverrides = new Map<string, boolean>();
const overrides = new Map<string, boolean>();
const killed = new Set<string>();
const listeners = new Set<TopicFlagListener>();
let initialised = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFile(doc: unknown): Map<string, TopicFlag> {
  const out = new Map<string, TopicFlag>();
  const topics = isRecord(doc) && isRecord(doc.realtime) ? doc.realtime.topics : undefined;
  if (!isRecord(topics)) {
    if (doc !== undefined) console.warn("[realtime-flags] missing or malformed realtime.topics; all topics disabled");
    return out;
  }
  for (const [topic, entry] of Object.entries(topics)) {
    if (!isRecord(entry) || typeof entry.enabled !== "boolean" || (entry.kill !== undefined && typeof entry.kill !== "boolean")) {
      console.warn(`[realtime-flags] malformed entry for topic "${topic}"; treating as disabled`);
      out.set(topic, { enabled: false, kill: false });
      continue;
    }
    out.set(topic, { enabled: entry.enabled, kill: entry.kill === true });
  }
  return out;
}

function parseEnv(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const raw = process.env.NEXT_PUBLIC_REALTIME_TOPICS_OVERRIDE;
  if (!raw) return out;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("not an object");
    for (const [topic, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") out.set(topic, value);
      else console.warn(`[realtime-flags] ignoring non-boolean env override for "${topic}"`);
    }
  } catch {
    console.warn("[realtime-flags] malformed NEXT_PUBLIC_REALTIME_TOPICS_OVERRIDE ignored");
  }
  return out;
}

/** Resolves a topic's flag without side effects. Read-through of the cached state. */
export function isTopicEnabled(topic: string): boolean {
  if (killed.has(topic)) return false;
  const file = fileFlags.get(topic);
  if (file?.kill) return false;
  const override = overrides.get(topic);
  if (override !== undefined) return override;
  const env = envOverrides.get(topic);
  if (env !== undefined) return env;
  return file?.enabled ?? false;
}

function snapshot(): Map<string, boolean> {
  const topics = new Set([...fileFlags.keys(), ...envOverrides.keys(), ...overrides.keys(), ...killed]);
  return new Map([...topics].map((t) => [t, isTopicEnabled(t)]));
}

function mutate(change: () => void): void {
  const before = snapshot();
  change();
  const after = snapshot();
  for (const [topic, enabled] of after) {
    if (before.get(topic) !== enabled && !(before.get(topic) === undefined && !enabled)) {
      listeners.forEach((listener) => listener(topic, enabled));
    }
  }
}

/** Reads the flags document once and caches it. Never throws. */
export function initRealtimeFlags(doc?: unknown): void {
  mutate(() => {
    fileFlags = parseFile(doc);
    envOverrides = parseEnv();
    initialised = true;
  });
}

/** Fetches /flags.json and initialises; any failure leaves every topic disabled. */
export async function loadRealtimeFlags(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(FLAGS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    initRealtimeFlags(await res.json());
  } catch {
    console.warn("[realtime-flags] could not load flags; all topics disabled");
    initRealtimeFlags(undefined);
  }
}

export function setTopicOverride(topic: string, value: boolean | null): void {
  mutate(() => {
    if (value === null) overrides.delete(topic);
    else overrides.set(topic, value);
  });
}

/** Kills a topic for already-connected sessions too (listeners tear subscriptions down). */
export function killTopic(topic: string): void {
  mutate(() => killed.add(topic));
}

export function reviveTopic(topic: string): void {
  mutate(() => killed.delete(topic));
}

/** Observable for telemetry and for the registry to react to mid-session flips. */
export function onTopicFlagChange(listener: TopicFlagListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetRealtimeFlagsForTests(): void {
  fileFlags = new Map();
  envOverrides = new Map();
  overrides.clear();
  killed.clear();
  listeners.clear();
  initialised = false;
}

export function realtimeFlagsInitialised(): boolean {
  return initialised;
}
