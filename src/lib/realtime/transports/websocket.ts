import { retryWithBackoff } from "../../retry";

export interface WebSocketTransportOptions {
  url: string;
  /** Extra reconnect attempts after the first connection drops. */
  retries?: number;
  /** Delay before the first reconnect; doubles on each subsequent one. */
  baseDelayMs?: number;
  onMessage?: (data: string) => void;
  onError?: (err: unknown) => void;
}

/** Close codes that indicate a transient failure worth retrying. */
const RETRYABLE_CLOSE_CODES = new Set([1006, 1011, 1012, 1013]);

/** Error raised when the socket closes with a code we should not retry. */
export class WebSocketTerminalCloseError extends Error {
  constructor(public readonly code: number, reason: string) {
    super(`WebSocket closed with non-retryable code ${code}${reason ? `: ${reason}` : ""}`);
    this.name = "WebSocketTerminalCloseError";
  }
}

export class WebSocketTransport {
  private socket: WebSocket | null = null;
  private closedByClient = false;

  constructor(private readonly options: WebSocketTransportOptions) {}

  connect(): Promise<void> {
    this.closedByClient = false;
    return retryWithBackoff(() => this.openOnce(), {
      retries: this.options.retries ?? 5,
      baseDelayMs: this.options.baseDelayMs ?? 500,
      isRetryable: (err) =>
        err instanceof WebSocketTerminalCloseError ? false : true,
    });
  }

  close(): void {
    this.closedByClient = true;
    this.socket?.close(1000, "client shutdown");
    this.socket = null;
  }

  private openOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.options.url);
      this.socket = socket;

      socket.onopen = () => resolve();
      socket.onmessage = (event) => this.options.onMessage?.(String(event.data));
      socket.onerror = (event) => this.options.onError?.(event);
      socket.onclose = (event) => {
        this.socket = null;
        if (this.closedByClient) return;
        if (RETRYABLE_CLOSE_CODES.has(event.code)) {
          reject(new Error(`WebSocket closed with retryable code ${event.code}`));
          return;
        }
        const err = new WebSocketTerminalCloseError(event.code, event.reason);
        this.options.onError?.(err);
        reject(err);
      };
    });
  }
}
