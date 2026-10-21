import { API_BASE_URL } from "@/lib/api/client";
import { Coalescer, TopicSequencer, type Envelope } from "./merge";
import { SseTransport } from "./sse";
import { TabLeader } from "./tabs";
import { WebSocketTransport, type Transport, type TransportKind } from "./transport";

type Handler = (payload: unknown) => void;
type Status = "idle" | "connecting" | "open" | "closed";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const GAP_TIMEOUT_MS = 2_000;

/**
 * A small reconnecting realtime wrapper exposing a subscribe-by-topic API.
 * The backend contract this assumes (documented, not yet implemented
 * upstream): JSON messages shaped
 * `{ topic: string, seq?: number, kind?: "replace" | "append", payload: unknown }`.
 * WebSocket is preferred; if it never opens, the client falls back to SSE
 * (outbound `subscribe`/`resync` messages are POSTed since SSE is read-only).
 * Only one browser tab holds the connection; others receive its messages over
 * BroadcastChannel. Callers must treat this connection as best-effort — always
 * keep an independent REST fetch as the source of truth for initial state.
 */
class RealtimeClient {
  private transport: Transport | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private sequencers = new Map<string, TopicSequencer>();
  private gapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private coalescer = new Coalescer((topic, payload) => this.handlers.get(topic)?.forEach((h) => h(payload)));
  private statusListeners = new Set<(status: Status) => void>();
  private status: Status = "idle";
  private attempt = 0;
  private everOpened = false;
  private useSse = false;
  private closedByUser = false;
  private started = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private leader: TabLeader | null = null;
  private subscribed = new Set<string>();

  get activeTransport(): TransportKind | null {
    return this.transport?.kind ?? null;
  }

  getStatus(): Status {
    return this.status;
  }

  onStatus(listener: (status: Status) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: Status): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  connect(): void {
    if (typeof WebSocket === "undefined" || this.started) return;
    this.started = true;
    this.closedByUser = false;
    this.leader = new TabLeader(
      (isLeader) => (isLeader ? this.open() : this.closeTransport()),
      (raw) => this.ingest(raw),
      () => this.syncTopics()
    );
    this.leader.start();
  }

  private baseUrl(): string {
    return API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
  }

  private open(): void {
    if (this.transport || !this.leader?.isLeader) return;
    const wsUrl = this.baseUrl();
    const httpUrl = API_BASE_URL.replace(/\/api\/v1$/, "");
    this.transport = this.useSse
      ? new SseTransport(`${httpUrl}/events`, `${httpUrl}/events/subscribe`)
      : new WebSocketTransport(wsUrl);
    this.setStatus("connecting");
    const transport = this.transport;
    transport.connect({
      onOpen: () => {
        this.attempt = 0;
        this.subscribed.clear();
        this.everOpened = true;
        this.setStatus("open");
        this.syncTopics();
      },
      onMessage: (raw) => {
        this.leader?.broadcast(raw);
        this.ingest(raw);
      },
      onClose: () => {
        if (this.transport !== transport) return;
        this.transport = null;
        this.setStatus("closed");
        // WebSocket never established (blocked proxy): switch to SSE.
        if (!this.everOpened && !this.useSse && typeof EventSource !== "undefined") this.useSse = true;
        if (!this.closedByUser) this.scheduleReconnect();
      },
    });
  }

  private closeTransport(): void {
    const t = this.transport;
    this.transport = null;
    t?.close();
  }

  private ingest(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch {
      return; // Malformed message — ignore, don't crash the connection.
    }
    if (typeof env?.topic !== "string") return;

    let seqr = this.sequencers.get(env.topic);
    if (!seqr) {
      seqr = new TopicSequencer((fromSeq, toSeq) => this.transport?.send({ type: "resync", topic: env.topic, fromSeq, toSeq }));
      this.sequencers.set(env.topic, seqr);
    }
    const ready = seqr.push(env);
    ready.forEach((e) => this.coalescer.add(e));

    // A hole is outstanding if nothing was released for an out-of-order arrival: resolve it after a timeout.
    clearTimeout(this.gapTimers.get(env.topic));
    if (env.seq !== undefined && !ready.length) {
      this.gapTimers.set(
        env.topic,
        setTimeout(() => {
          seqr!.flush().forEach((e) => this.coalescer.add(e));
        }, GAP_TIMEOUT_MS)
      );
    }
  }

  /** Topics needed by this tab or any other tab; the leader subscribes to the union. */
  private syncTopics(): void {
    const own = [...this.handlers.keys()].filter((t) => this.handlers.get(t)!.size > 0);
    this.leader?.announceTopics(own);
    if (!this.leader?.isLeader) return;
    const all = new Set([...own, ...this.leader.remoteTopics()]);
    all.forEach((topic) => !this.subscribed.has(topic) && this.transport?.send({ type: "subscribe", topic }));
    this.subscribed.forEach((topic) => !all.has(topic) && this.transport?.send({ type: "unsubscribe", topic }));
    this.subscribed = all;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  subscribe(topic: string, handler: Handler): () => void {
    const isNew = !this.handlers.get(topic)?.size;
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.connect();
    if (isNew) this.syncTopics();

    return () => {
      this.handlers.get(topic)?.delete(handler);
      if (!this.handlers.get(topic)?.size) this.syncTopics();
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.gapTimers.forEach(clearTimeout);
    this.gapTimers.clear();
    this.leader?.stop();
    this.leader = null;
    this.closeTransport();
    this.setStatus("closed");
  }
}

export const realtimeClient = new RealtimeClient();
