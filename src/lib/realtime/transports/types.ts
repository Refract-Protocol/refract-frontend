import type { ClientMessage, Cursors } from "../topics";

export interface ConnectContext {
  /** Abort signal that fires when the transport should stop reconnecting. */
  signal?: AbortSignal;
}

/**
 * Structured payload emitted whenever a transport closes.
 *
 * - `code` mirrors the WebSocket close code / HTTP status / synthetic code.
 * - `reason` is a human-readable explanation suitable for logs and Sentry.
 * - `source` identifies which transport path produced the close.
 */
export interface TransportCloseEvent {
  code: number;
  reason: string;
  source: "websocket" | "sse" | "long-poll";
}

export interface TransportCallbacks {
  onOpen(): void;
  onFrame(data: unknown): void;
  onClose(info: TransportCloseEvent): void;
}

export interface RealtimeTransport {
  readonly kind: "websocket" | "sse" | "long-poll";
  connect(ctx: ConnectContext, callbacks: TransportCallbacks): void;
  disconnect(): void;
  send(message: ClientMessage): void;
  subscribe(topics: string[], cursors: Cursors): void;
  unsubscribe(topics: string[]): void;
}
