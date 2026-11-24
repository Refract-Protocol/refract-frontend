import { encodeCursors, type ClientMessage, type Cursors } from "../topics";
import type { ConnectContext, RealtimeTransport, TransportCallbacks, TransportCloseEvent } from "./types";

type EventSourceCtor = new (url: string, init?: EventSourceInit) => EventSource;

export interface SseTransportOptions {
  /** Endpoint, e.g. `${API_BASE_URL}/realtime/sse`. Topics and cursors go in the query string. */
  url: string;
  EventSourceImpl?: EventSourceCtor;
}

/**
 * Server-Sent Events transport. SSE is one-way, so subscription changes
 * reopen the stream with the new topic set and current cursors. The browser's
 * own auto-reconnect is disabled (we close on error) so reconnect policy stays
 * with the client.
 */
export class SseTransport implements RealtimeTransport {
  readonly kind = "sse" as const;
  private source: EventSource | null = null;
  private callbacks: TransportCallbacks | null = null;
  private ctx: ConnectContext | null = null;
  private topics = new Set<string>();

  constructor(private readonly opts: SseTransportOptions) {}

  connect(ctx: ConnectContext, callbacks: TransportCallbacks): void {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.topics = new Set(ctx.topics);
    this.open();
  }

  disconnect(): void {
    this.callbacks = null;
    this.source?.close();
    this.source = null;
  }

  send(_message: ClientMessage): void {
    // One-way transport: subscription changes are expressed by reopening.
  }

  subscribe(topics: string[], _cursors: Cursors): void {
    const before = this.topics.size;
    topics.forEach((t) => this.topics.add(t));
    if (this.topics.size !== before) this.reopen();
  }

  unsubscribe(topics: string[]): void {
    const before = this.topics.size;
    topics.forEach((t) => this.topics.delete(t));
    if (this.topics.size !== before) this.reopen();
  }

  private reopen(): void {
    if (!this.callbacks) return;
    this.source?.close();
    this.source = null;
    this.open();
  }

  private open(): void {
    const Impl = this.opts.EventSourceImpl ?? EventSource;
    const params = new URLSearchParams({ topics: [...this.topics].join(",") });
    const cursors = encodeCursors(this.ctx?.getCursors() ?? {});
    if (cursors) params.set("after", cursors);

    let source: EventSource;
    try {
      source = new Impl(`${this.opts.url}?${params}`, { withCredentials: true });
    } catch (err) {
      queueMicrotask(() =>
        this.finish({ code: 1006, reason: `connect failed: ${String(err)}`, source: "sse" }),
      );
      return;
    }
    this.source = source;
    source.onopen = () => {
      if (this.source === source) this.callbacks?.onOpen();
    };
    source.onmessage = (event) => {
      if (this.source === source) this.callbacks?.onFrame(event.data);
    };
    source.onerror = () => {
      if (this.source !== source) return;
      // EventSource exposes no status code; readyState distinguishes a
      // terminal CLOSED stream from a transient CONNECTING retry.
      const readyState = source.readyState;
      source.close();
      const reason =
        readyState === 2 /* CLOSED */ ? "event stream closed" : "event stream error";
      this.finish({ code: 1006, reason, source: "sse" });
    };
  }

  private finish(info: TransportCloseEvent): void {
    const callbacks = this.callbacks;
    this.source = null;
    this.callbacks = null;
    callbacks?.onClose(info);
  }
}
