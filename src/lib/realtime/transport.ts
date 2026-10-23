export type TransportKind = "websocket" | "sse";

export interface TransportHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onClose: () => void;
}

/** Minimal contract both transports satisfy so hooks stay transport-agnostic. */
export interface Transport {
  readonly kind: TransportKind;
  connect(handlers: TransportHandlers): void;
  /** Outbound control message (subscribe / resync). */
  send(message: object): void;
  close(): void;
}

export class WebSocketTransport implements Transport {
  readonly kind = "websocket" as const;
  private socket: WebSocket | null = null;

  constructor(private readonly url: string) {}

  connect({ onOpen, onMessage, onClose }: TransportHandlers): void {
    try {
      this.socket = new WebSocket(this.url);
    } catch {
      onClose();
      return;
    }
    this.socket.addEventListener("open", onOpen);
    this.socket.addEventListener("message", (e) => onMessage(e.data as string));
    this.socket.addEventListener("close", onClose);
    this.socket.addEventListener("error", () => this.socket?.close());
  }

  send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
