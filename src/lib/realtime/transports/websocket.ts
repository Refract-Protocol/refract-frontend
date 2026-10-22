import type { ClientMessage, Cursors } from "../topics";
import type { ConnectContext, RealtimeTransport, TransportCallbacks } from "./types";

type WebSocketCtor = new (url: string) => WebSocket;

export interface WebSocketTransportOptions {
  url: string;
  /** Injectable for tests and the chaos harness. Defaults to the global WebSocket. */
  WebSocketImpl?: WebSocketCtor;
}

export class WebSocketTransport implements RealtimeTransport {
  readonly kind = "websocket" as const;
  private socket: WebSocket | null = null;
  private callbacks: TransportCallbacks | null = null;

  constructor(private readonly opts: WebSocketTransportOptions) {}

  connect(_ctx: ConnectContext, callbacks: TransportCallbacks): void {
    this.callbacks = callbacks;
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    let socket: WebSocket;
    try {
      socket = new Impl(this.opts.url);
    } catch (err) {
      queueMicrotask(() => this.finish({ code: 1006, reason: `connect failed: ${String(err)}` }));
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket === socket) this.callbacks?.onOpen();
    });
    socket.addEventListener("message", (event) => {
      if (this.socket === socket) this.callbacks?.onFrame(event.data);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.finish({ code: event.code, reason: event.reason });
    });
    socket.addEventListener("error", () => {
      // A close event always follows; let it carry the code.
      if (this.socket === socket) socket.close();
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.callbacks = null;
    socket?.close(1000, "client disconnect");
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === 1 /* OPEN */) {
      this.socket.send(JSON.stringify(message));
    }
  }

  subscribe(topics: string[], cursors: Cursors): void {
    const relevant = Object.fromEntries(
      Object.entries(cursors).filter(([topic]) => topics.includes(topic))
    );
    this.send({ type: "subscribe", topics, cursors: relevant });
  }

  unsubscribe(topics: string[]): void {
    this.send({ type: "unsubscribe", topics });
  }

  private finish(info: { code: number; reason: string }): void {
    const callbacks = this.callbacks;
    this.socket = null;
    this.callbacks = null;
    callbacks?.onClose(info);
  }
}
