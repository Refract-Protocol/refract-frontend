/** In-memory WebSocket stand-in for realtime client tests and local scenarios. */
export class MockRealtimeSocket extends EventTarget {
  static readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  constructor(
    readonly url: string,
    openDelayMs = 0,
    private readonly autoPong = true
  ) {
    super();
    setTimeout(() => {
      if (this.closed) return;
      this.readyState = MockRealtimeSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    }, openDelayMs);
  }
  send(data: string): void {
    this.sent.push(data);
    if (!this.autoPong) return;
    try {
      const envelope = JSON.parse(data) as { topic?: string; payload?: { type?: string } };
      if (envelope.topic === "$control" && envelope.payload?.type === "ping") {
        this.emit("$control", { type: "pong" });
      }
    } catch {
      // Ignore invalid test client frames.
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  emit(topic: string, payload: unknown): void {
    const event = new Event("message");
    Object.defineProperty(event, "data", { value: JSON.stringify({ topic, payload }) });
    this.dispatchEvent(event);
  }
}

export function createMockRealtimeServer(openDelayMs = 0, autoPong = true) {
  const sockets: MockRealtimeSocket[] = [];
  return {
    sockets,
    socketFactory: (url: string) => {
      const socket = new MockRealtimeSocket(url, openDelayMs, autoPong);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    control: (socket: MockRealtimeSocket, payload: unknown) => socket.emit("$control", payload),
    message: (socket: MockRealtimeSocket, topic: string, payload: unknown) =>
      socket.emit(topic, payload),
  };
}
