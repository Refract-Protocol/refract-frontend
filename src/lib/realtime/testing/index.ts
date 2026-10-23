/**
 * Test-only kit: an in-memory realtime transport. Import from
 * `@/lib/realtime/testing` in tests only — nothing in `src/` outside tests may
 * import it, so it never reaches the production bundle.
 */
import {
  __setTransportFactory,
  realtimeClient,
  type RealtimeTransport,
} from "../client";
import type { RealtimeTopic, TopicPayload } from "../contract";

type Listener = (event: { data?: unknown }) => void;

export class FakeTransport implements RealtimeTransport {
  readonly sent: string[] = [];
  closed = false;
  private listeners: Record<string, Listener[]> = { open: [], message: [], close: [], error: [] };

  addEventListener(type: "open" | "message" | "close" | "error", listener: Listener): void {
    this.listeners[type].push(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fire("close");
  }

  private fire(type: string, event: { data?: unknown } = {}): void {
    [...this.listeners[type]].forEach((l) => l(event));
  }

  get listenerCount(): number {
    return Object.values(this.listeners).reduce((n, l) => n + l.length, 0);
  }

  /** Force the connection open. */
  open(): void {
    this.fire("open");
  }

  /** Emit a push event; the payload type is derived from the contract. */
  emit<K extends RealtimeTopic>(topic: K, payload: TopicPayload<K>): void {
    this.fire("message", { data: JSON.stringify({ topic, payload }) });
  }

  /** Emit a raw server frame (responses, errors, malformed data). */
  emitRaw(frame: unknown): void {
    this.fire("message", { data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }

  respond(id: number, response: unknown): void {
    this.emitRaw({ id, response });
  }

  fail(id: number, code: string, message: string): void {
    this.emitRaw({ id, error: { code, message } });
  }

  /** Force a transport error (the client closes and schedules a reconnect). */
  error(): void {
    this.fire("error");
  }

  /** Simulate a server-side drop. */
  drop(): void {
    this.closed = true;
    this.fire("close");
  }
}

export interface FakeRealtime {
  /** Every transport the client opened, in order. */
  transports: FakeTransport[];
  /** The most recent transport. */
  readonly current: FakeTransport;
  /** Resolves once the client has opened `n` transports (default 1). */
  waitForConnection(n?: number): Promise<FakeTransport>;
  /** Tear down: disconnect, reset the client and restore the real transport. */
  teardown(): void;
}

/** Install the fake transport into the realtime client. Call `teardown()` in afterEach. */
export function installFakeRealtime(): FakeRealtime {
  realtimeClient.__reset();
  const transports: FakeTransport[] = [];
  __setTransportFactory(() => {
    const t = new FakeTransport();
    transports.push(t);
    return t;
  });
  return {
    transports,
    get current() {
      return transports[transports.length - 1];
    },
    async waitForConnection(n = 1) {
      for (let i = 0; i < 100 && transports.length < n; i += 1) await Promise.resolve();
      if (transports.length < n) throw new Error(`Expected ${n} transport(s), got ${transports.length}`);
      return transports[n - 1];
    },
    teardown() {
      realtimeClient.__reset();
      __setTransportFactory(null);
    },
  };
}
