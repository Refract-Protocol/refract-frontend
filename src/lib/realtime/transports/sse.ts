import type { ClientMessage, Cursors } from "../topics";
import type {
  ConnectContext,
  RealtimeTransport,
  TransportCallbacks,
  TransportCloseEvent,
} from "./types";

export interface SseTransportOptions {
  url: string;
  /** Injectable for tests and the chaos harness. Defaults to the global EventSource. */
  EventSourceImpl?: typeof EventSource;
}

export class SseTransport implements RealtimeTransport {
  readonly kind = "sse" as const;
  private source: EventSource | null = null;
  private callbacks: TransportCallbacks | null = null;

  constructor(private readonly opts: SseTransportOptions) {}

  connect(_ctx: ConnectContext, callbacks: TransportCallbacks): void {
    this.callbacks = callbacks;
    const Impl = this.opts.EventSourceImpl ?? EventSource;
    let source: EventSource;
    try {
      source = new Impl(this.opts.url);
    } catch (err) {
      queueMicrotask(() => this.finish({ code: 1006, reason: `connect failed: ${String(err)}` }));
      return;
    }
    this.source = source;

    source.addEventListener("open", () => {
      if (this.source === source) this.callbacks?.onOpen();
    });
    source.addEventListener("message", (event) => {
      if (this.source !== source) return;
      try {
        this.callbacks?.onFrame(JSON.parse((event as MessageEvent).data));
      } catch {
        // Ignore malformed frames; the server is expected to send JSON.
      }
    });
    source.addEventListener("error", () => {
      if (this.source !== source) return;
      this.finish({ code: 1006, reason: "sse error" });
    });
  }

  disconnect(): void {
    const source = this.source;
    this.source = null;
    this.callbacks = null;
    source?.close();
  }

  send(_message: ClientMessage): void {
    // SSE is server-to-client only; outbound messages go over HTTP.
  }

  subscribe(_topics: string[], _cursors: Cursors): void {
    // Subscriptions are encoded in the SSE URL.
  }

  unsubscribe(_topics: string[]): void {
    // Subscriptions are encoded in the SSE URL.
  }

  private finish(info: TransportCloseEvent): void {
    const callbacks = this.callbacks;
    this.source = null;
    this.callbacks = null;
    callbacks?.onClose(info);
  }
}
