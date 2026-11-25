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
  /**
   * Optional hint for the initial delay (in ms) the transport should wait
   * before its first reconnect attempt.  Corresponds to the SSE `retry:`
   * field and to the documented `reconnectDelay` client option.  Transports
   * that implement their own backoff loop SHOULD honour this value as the
   * base delay for the first attempt; they MAY ignore it if the server
   * supplies a more specific backoff via protocol-level metadata (e.g. a
   * `Retry-After` header or an SSE `retry:` event).  Defaults to 1 000 ms
   * when absent (issue #546).
   */
  reconnectDelay?: number;
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
