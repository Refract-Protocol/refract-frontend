import { describe, expect, it, vi } from "vitest";
import {
  buildSseUrl,
  type EventSourceLike,
  NegotiatedRealtimeTransport,
  type RealtimeMessageHandler,
  type RealtimeTransport,
  SseRealtimeTransport,
} from "./sse";

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {}

  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: unknown): void {
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: raw }));
  }

  emitError(): void {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
}

describe("SSE Fallback Transport", () => {
  it("encodes topics, resume cursors, and wallet auth in the SSE endpoint URL", () => {
    const url = buildSseUrl({
      baseUrl: "https://api.refract.example/api/v1",
      topics: new Set(["pool.stats", "oracle.readings"]),
      cursors: { "oracle.readings": 42, "claims.settlement": 7 },
      walletAddress: "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR",
      authToken: "jwt-token-123",
    });

    expect(url).toBe(
      "https://api.refract.example/events?topics=oracle.readings%2Cpool.stats&cursor%5Bclaims.settlement%5D=7&cursor%5Boracle.readings%5D=42&wallet=GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR&token=jwt-token-123",
    );
  });

  it("delivers topic messages, tracks sequence cursors, and closes EventSource on error before scheduling retry", () => {
    vi.useFakeTimers();
    const instances: FakeEventSource[] = [];
    const transport = new SseRealtimeTransport({
      baseUrl: "https://api.refract.example/api/v1",
      reconnectDelayMs: 500,
      eventSourceFactory: (url) => {
        const es = new FakeEventSource(url);
        instances.push(es);
        return es;
      },
    });

    const received: unknown[] = [];
    const unsubscribe = transport.subscribe("oracle.readings", (payload) => {
      received.push(payload);
    });

    expect(instances).toHaveLength(1);
    expect(transport.getState()).toBe("connecting");

    instances[0].emitOpen();
    expect(transport.getState()).toBe("open");

    instances[0].emitMessage({
      topic: "oracle.readings",
      seq: 15,
      payload: { coverageType: "USDC Depeg", value: 0.999 },
    });
    expect(received).toEqual([{ coverageType: "USDC Depeg", value: 0.999 }]);

    // Error must close the underlying EventSource so native browser retry does not fight backoff
    instances[0].emitError();
    expect(instances[0].closed).toBe(true);
    expect(transport.getState()).toBe("reconnecting");

    vi.advanceTimersByTime(500);
    expect(instances).toHaveLength(2);
    expect(instances[1].url).toContain("cursor%5Boracle.readings%5D=15");

    unsubscribe();
    transport.close();
    expect(transport.getState()).toBe("closed");
    vi.useRealTimers();
  });

  it("re-opens stream with updated query params when subscribe or auth state changes", () => {
    const instances: FakeEventSource[] = [];
    const transport = new SseRealtimeTransport({
      baseUrl: "https://api.refract.example/api/v1",
      topics: ["oracle.readings"],
      eventSourceFactory: (url) => {
        const es = new FakeEventSource(url);
        instances.push(es);
        return es;
      },
    });

    transport.connect();
    instances[0].emitOpen();
    expect(instances[0].url).toContain("topics=oracle.readings");

    transport.send({
      type: "subscribe",
      topics: ["notifications"],
      auth: { walletAddress: "GABC123", token: "tok_xyz" },
    });

    expect(instances[0].closed).toBe(true);
    expect(instances).toHaveLength(2);
    expect(instances[1].url).toContain("topics=notifications%2Coracle.readings");
    expect(instances[1].url).toContain("wallet=GABC123");
    expect(instances[1].url).toContain("token=tok_xyz");
  });

  it("falls back from WebSocket to SSE when the WebSocket handshake fails", () => {
    let handshakeFailCallback: (() => void) | null = null;
    const primaryMessages = new Set<RealtimeMessageHandler>();

    const fakePrimary: RealtimeTransport & {
      onHandshakeFailed: (cb: () => void) => void;
    } = {
      kind: "websocket",
      connect: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      onMessage: (handler) => {
        primaryMessages.add(handler);
        return () => primaryMessages.delete(handler);
      },
      getState: () => "connecting",
      onHandshakeFailed: (cb) => {
        handshakeFailCallback = cb;
      },
    };

    const sseInstances: FakeEventSource[] = [];
    const negotiated = new NegotiatedRealtimeTransport({
      createPrimary: () => fakePrimary,
      createFallback: () =>
        new SseRealtimeTransport({
          baseUrl: "https://api.refract.example/api/v1",
          topics: ["oracle.readings"],
          eventSourceFactory: (url) => {
            const es = new FakeEventSource(url);
            sseInstances.push(es);
            return es;
          },
        }),
    });

    const delivered: unknown[] = [];
    negotiated.onMessage((msg) => delivered.push(msg));
    negotiated.connect();

    expect(negotiated.getActiveTransportKind()).toBe("websocket");

    // Simulate WebSocket upgrade rejection
    handshakeFailCallback!();

    expect(fakePrimary.close).toHaveBeenCalledTimes(1);
    expect(negotiated.getActiveTransportKind()).toBe("sse");
    expect(sseInstances).toHaveLength(1);

    sseInstances[0].emitOpen();
    sseInstances[0].emitMessage({
      topic: "oracle.readings",
      payload: { value: 1.0 },
    });

    expect(delivered).toEqual([{ topic: "oracle.readings", payload: { value: 1.0 } }]);
    negotiated.close();
    expect(negotiated.getActiveTransportKind()).toBe("none");
  });
});
