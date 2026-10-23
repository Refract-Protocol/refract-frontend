import type { Transport, TransportHandlers } from "./transport";

/**
 * Server-Sent Events transport. SSE is unidirectional, so outbound control
 * messages (subscribe / resync) go through a separate REST POST to
 * `${postUrl}`; the stream itself is `${streamUrl}`. Auth is a `token` query
 * param because EventSource cannot set headers.
 */
export class SseTransport implements Transport {
  readonly kind = "sse" as const;
  private source: EventSource | null = null;

  constructor(
    private readonly streamUrl: string,
    private readonly postUrl: string,
    private readonly getToken: () => string | null = () => null
  ) {}

  connect({ onOpen, onMessage, onClose }: TransportHandlers): void {
    if (typeof EventSource === "undefined") {
      onClose();
      return;
    }
    const token = this.getToken();
    const url = token ? `${this.streamUrl}${this.streamUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : this.streamUrl;
    this.source = new EventSource(url);
    this.source.onopen = onOpen;
    this.source.onmessage = (e) => onMessage(e.data as string);
    // EventSource auto-reconnects natively; close it so the client's own backoff is the only retry logic.
    this.source.onerror = () => {
      this.source?.close();
      this.source = null;
      onClose();
    };
  }

  send(message: object): void {
    const token = this.getToken();
    void fetch(this.postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(message),
    }).catch(() => {
      // Best-effort: the next reconnect re-sends subscriptions.
    });
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }
}
