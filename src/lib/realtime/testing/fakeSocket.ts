import type { WebSocketLike } from "../client";

type Listener = (event: any) => void;

/** In-memory WebSocket stand-in for realtime tests. */
export class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  private listeners: Record<string, Listener[]> = {};

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.emit("close", { code, wasClean: code === 1000 });
  }

  // ── Test controls ──
  serverOpen(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  serverSend(frame: unknown): void {
    this.emit("message", { data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }

  serverDrop(code = 1006): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close", { code, wasClean: false });
  }

  subscriptions(): Record<string, unknown>[] {
    return this.sent.filter((m) => m.type === "subscribe");
  }

  private emit(type: string, event: unknown): void {
    (this.listeners[type] ?? []).forEach((listener) => listener(event));
  }
}

/** Socket factory that records every socket it creates. */
export function fakeSocketFactory() {
  const sockets: FakeSocket[] = [];
  const create = (url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  };
  return { sockets, create, latest: () => sockets[sockets.length - 1]! };
}
