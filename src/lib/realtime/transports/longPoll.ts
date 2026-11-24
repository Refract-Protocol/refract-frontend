import type { ClientMessage, Cursors } from "../topics";
import type {
  ConnectContext,
  RealtimeTransport,
  TransportCallbacks,
  TransportCloseEvent,
} from "./types";

export interface LongPollTransportOptions {
  url: string;
  /** Injectable for tests and the chaos harness. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Delay between polls in ms. */
  intervalMs?: number;
}

export class LongPollTransport implements RealtimeTransport {
  readonly kind = "longPoll" as const;
  private callbacks: TransportCallbacks | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly opts: LongPollTransportOptions) {}

  connect(_ctx: ConnectContext, callbacks: TransportCallbacks): void {
    this.callbacks = callbacks;
    this.stopped = false;
    this.callbacks.onOpen();
    this.schedule();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.callbacks = null;
  }

  send(_message: ClientMessage): void {
    // Outbound messages go over HTTP; long-poll is server-to-client only.
  }

  subscribe(_topics: string[], _cursors: Cursors): void {
    // Subscriptions are encoded in the poll URL.
  }

  unsubscribe(_topics: string[]): void {
    // Subscriptions are encoded in the poll URL.
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.poll(), this.opts.intervalMs ?? 1000);
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    try {
      const res = await fetchImpl(this.opts.url);
      if (this.stopped) return;
      if (!res.ok) {
        this.finish({ code: res.status, reason: `poll failed: ${res.statusText}` });
        return;
      }
      const body = await res.json();
      if (this.stopped) return;
      this.callbacks?.onFrame(body);
      this.schedule();
    } catch (err) {
      if (this.stopped) return;
      this.finish({ code: 1006, reason: `poll error: ${String(err)}` });
    }
  }

  private finish(info: TransportCloseEvent): void {
    const callbacks = this.callbacks;
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.callbacks = null;
    callbacks?.onClose(info);
  }
}
