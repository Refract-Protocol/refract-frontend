/**
 * In-process fake WebSocket for tests and local tooling.
 *
 * DEV/TEST ONLY. Nothing under src/lib/realtime/dev may be imported by
 * production code: ESLint blocks the import and
 * scripts/check-realtime-bundle.mjs fails the build if the marker below shows
 * up in `.next/static`.
 */

export const REALTIME_DEV_ONLY_MARKER = "__REFRACT_REALTIME_DEV_ONLY__";

type Listener = (event: { data?: unknown }) => void;

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every socket constructed, newest last. */
  static instances: FakeWebSocket[] = [];
  /** Extensions header the fake "server" will accept on the next `open()`. */
  static nextExtensions = "";

  readonly marker = REALTIME_DEV_ONLY_MARKER;
  readyState = FakeWebSocket.CONNECTING;
  extensions = "";
  binaryType: "blob" | "arraybuffer" = "blob";
  /** Frames the client sent, parsed. */
  sent: unknown[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
    readonly options?: unknown
  ) {
    FakeWebSocket.instances.push(this);
  }

  static latest(): FakeWebSocket {
    const s = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!s) throw new Error("No FakeWebSocket has been constructed");
    return s;
  }

  static reset(): void {
    FakeWebSocket.instances = [];
    FakeWebSocket.nextExtensions = "";
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  // --- "server" side --------------------------------------------------------

  /** Completes the handshake, optionally accepting extensions. */
  open(extensions = FakeWebSocket.nextExtensions): void {
    this.extensions = extensions;
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  /** Delivers a raw frame (string or ArrayBuffer). */
  receiveRaw(data: unknown): void {
    this.emit("message", { data });
  }

  /** Delivers a `{ topic, payload, ts? }` envelope as a JSON text frame. */
  push(topic: string, payload: unknown, ts?: number): void {
    this.receiveRaw(JSON.stringify(ts === undefined ? { topic, payload } : { topic, payload, ts }));
  }

  private emit(type: string, event: { data?: unknown }): void {
    this.listeners.get(type)?.forEach((l) => l(event));
  }
}
