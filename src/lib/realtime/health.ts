/**
 * Observable realtime health. The client writes it; the adaptive polling
 * scheduler (src/lib/polling/adaptivePolling.ts) reads it to decide how often
 * REST fallbacks should poll. It knows nothing about WebSocket vs SSE, so any
 * transport that reports through `setConnection` behaves identically.
 *
 * - healthy:     connected and expected to push updates for the topic.
 * - degraded:    reconnecting after a drop; pushes may be missed for a while.
 * - unavailable: realtime is off, gave up reconnecting, or the topic fell back to REST.
 */
export type RealtimeHealth = "healthy" | "degraded" | "unavailable";

export interface HealthSource {
  /** Health for a topic (or the connection as a whole when `topic` is omitted). */
  get(topic?: string): RealtimeHealth;
  subscribe(listener: () => void): () => void;
}

export class RealtimeHealthStore implements HealthSource {
  private connection: RealtimeHealth = "unavailable";
  /** Topics that degraded to REST (e.g. unsupported version) regardless of connection state. */
  private restOnly = new Set<string>();
  private listeners = new Set<() => void>();

  get(topic?: string): RealtimeHealth {
    if (topic && this.restOnly.has(topic)) return "unavailable";
    return this.connection;
  }

  /** True when the topic has been permanently degraded to REST for this session/scope. */
  isRestOnly(topic: string): boolean {
    return this.restOnly.has(topic);
  }

  setConnection(next: RealtimeHealth): void {
    if (next === this.connection) return;
    this.connection = next;
    this.emit();
  }

  markRestOnly(topic: string): void {
    if (this.restOnly.has(topic)) return;
    this.restOnly.add(topic);
    this.emit();
  }

  /** Clears per-topic fallbacks, e.g. after a scope change opens a fresh session. */
  resetTopics(): void {
    if (this.restOnly.size === 0) return;
    this.restOnly.clear();
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
