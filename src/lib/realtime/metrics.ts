export type Direction = "in" | "out";

interface TopicBytes {
  in: number;
  out: number;
  messages: number;
}

const HOUR_MS = 3_600_000;
const topics = new Map<string, TopicBytes>();
const listeners = new Set<() => void>();
let startedAt = Date.now();
let snapshot = buildSnapshot();

/** UTF-8 byte length of a string without allocating a buffer. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Count bytes at the wire boundary (decoded text frame payloads). Compression,
 * WebSocket framing and TCP/TLS headers are NOT included, so this undercounts
 * network usage on compressed connections and overcounts versus compressed size.
 * Totals are cumulative for the page session and survive reconnects.
 */
export function recordBytes(topic: string, direction: Direction, bytes: number): void {
  let t = topics.get(topic);
  if (!t) topics.set(topic, (t = { in: 0, out: 0, messages: 0 }));
  t[direction] += bytes;
  t.messages += 1;
}

function buildSnapshot() {
  let bytesIn = 0;
  let bytesOut = 0;
  let messages = 0;
  const byTopic: Record<string, TopicBytes & { avgPayload: number }> = {};
  topics.forEach((t, name) => {
    bytesIn += t.in;
    bytesOut += t.out;
    messages += t.messages;
    byTopic[name] = { ...t, avgPayload: t.messages ? Math.round((t.in + t.out) / t.messages) : 0 };
  });
  const hours = Math.max((Date.now() - startedAt) / HOUR_MS, 1 / 60);
  return {
    bytesIn,
    bytesOut,
    messages,
    bytesPerHour: Math.round((bytesIn + bytesOut) / hours),
    byTopic,
  };
}

export type MetricsSnapshot = ReturnType<typeof buildSnapshot>;

export function getMetrics(): MetricsSnapshot {
  return snapshot;
}

/** Refresh the snapshot and notify subscribers; called at low frequency by the UI, never per message. */
export function sampleMetrics(): void {
  snapshot = buildSnapshot();
  listeners.forEach((l) => l());
}

export function subscribeMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetMetrics(): void {
  topics.clear();
  startedAt = Date.now();
  sampleMetrics();
}
