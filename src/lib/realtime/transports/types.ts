import type { ClientMessage, Cursors } from "../topics";

export type TransportKind = "websocket" | "sse" | "long-poll";

export interface TransportCloseInfo {
  code: number;
  reason: string;
  /** The server rejected our credentials; reconnecting will not help. */
  auth?: boolean;
  /** The server does not offer this transport at all (e.g. 404); try the next tier. */
  unsupported?: boolean;
}

export interface TransportCallbacks {
  onOpen(): void;
  /** A raw frame: a string (WS/SSE) or an already-parsed object (long-poll batch entries). */
  onFrame(frame: unknown): void;
  /** Called once when the transport stops on its own. Not called after `disconnect()`. */
  onClose(info: TransportCloseInfo): void;
}

export interface ConnectContext {
  topics: string[];
  /** Live view of the client's resume cursors; read at request time. */
  getCursors(): Cursors;
}

/**
 * The narrow, duck-typed contract every realtime transport implements.
 * Transports only move frames: decoding, de-duplication, cursors, reconnect
 * policy and fan-out all live in the client so they behave identically
 * regardless of which transport won negotiation.
 */
export interface RealtimeTransport {
  readonly kind: TransportKind;
  connect(ctx: ConnectContext, callbacks: TransportCallbacks): void;
  disconnect(): void;
  send(message: ClientMessage): void;
  subscribe(topics: string[], cursors: Cursors): void;
  unsubscribe(topics: string[]): void;
}

export interface TransportFactory {
  kind: TransportKind;
  isSupported(): boolean;
  create(): RealtimeTransport;
}
