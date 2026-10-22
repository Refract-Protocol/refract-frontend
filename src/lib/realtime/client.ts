import { API_BASE_URL } from "@/lib/api/client";
import { realtimeEndpoints } from "@/lib/network";
import { codecs, jsonCodec, selectCodec, type Codec } from "./codecs";
import {
  descriptor,
  matches,
  type Descriptor,
  type Interest,
  type Message,
  type Topic,
} from "./contract";
import { EndpointSelector } from "./endpoints";
import { Scheduler } from "./scheduler";
type Handler = (payload: unknown) => void;
interface Subscription {
  descriptor: Descriptor;
  handlers: Set<Handler>;
}
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private subscriptions = new Map<string, Subscription>();
  private attempt = 0;
  private closed = true;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private probeTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private codec: Codec = jsonCodec;
  readonly endpoints: EndpointSelector;
  selectedEndpoint?: string;
  readonly scheduler = new Scheduler(
    (m) => this.dispatch(m),
    () => new Set([...this.subscriptions.values()].map((s) => s.descriptor.topic)).size
  );
  constructor(urls = realtimeEndpoints(API_BASE_URL)) {
    this.endpoints = new EndpointSelector(urls);
  }
  connect() {
    if (typeof WebSocket === "undefined" || this.socket || this.reconnectTimer) return;
    this.closed = false;
    this.open();
  }
  private open() {
    const endpoint = this.endpoints.select();
    this.selectedEndpoint = endpoint.url;
    const started = Date.now();
    let received = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        endpoint.url,
        codecs.map((c) => c.subprotocol)
      );
    } catch {
      this.endpoints.failed(endpoint);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    this.connectTimer = setTimeout(() => socket.close(), 10_000);
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.codec = selectCodec(socket.protocol);
      this.subscriptions.forEach((s) => this.send("subscribe", s.descriptor));
      if (endpoint !== this.endpoints.health[0]) {
        this.probeTimer = setTimeout(() => {
          if (this.socket === socket) socket.close();
        }, this.endpoints.retryPreferredMs);
      }
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let message: Message;
      try {
        message = this.codec.decode(event.data);
      } catch {
        return;
      }
      if (!received) {
        received = true;
        clearTimeout(this.connectTimer);
        this.attempt = 0;
        this.endpoints.succeeded(endpoint, Date.now() - started);
      }
      if (
        [...this.subscriptions.values()].some(
          (s) => s.descriptor.topic === message.topic && matches(message, s.descriptor.interest)
        )
      ) {
        this.scheduler.enqueue(message);
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectTimer);
      clearTimeout(this.probeTimer);
      this.socket = null;
      if (!received) this.endpoints.failed(endpoint);
      if (!this.closed) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) socket.close();
    });
  }
  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = undefined;
        if (!this.closed) this.open();
      },
      Math.min(1000 * 2 ** this.attempt++, 30_000)
    );
  }
  private send(action: "subscribe" | "unsubscribe", subscription: Descriptor) {
    if (this.socket?.readyState === 1)
      this.socket.send(this.codec.encode({ action, ...subscription }));
  }
  subscribe(topic: Topic, handler: Handler, interest: Interest): () => void {
    const d = descriptor(topic, interest);
    const key = JSON.stringify(d);
    let sub = this.subscriptions.get(key);
    if (!sub) {
      sub = { descriptor: d, handlers: new Set() };
      this.subscriptions.set(key, sub);
      this.send("subscribe", d);
    }
    // Each registration gets its own identity, including duplicate callback references.
    const listener: Handler = (payload) => handler(payload);
    sub.handlers.add(listener);
    this.connect();
    return () => {
      const current = this.subscriptions.get(key);
      if (!current?.handlers.delete(listener)) return;
      if (!current.handlers.size) {
        this.send("unsubscribe", d);
        this.subscriptions.delete(key);
      }
      if (!this.subscriptions.size) this.disconnect();
    };
  }
  private dispatch(message: Message) {
    this.subscriptions.forEach(({ descriptor: d, handlers }) => {
      if (d.topic === message.topic && matches(message, d.interest))
        handlers.forEach((handler) => {
          try {
            handler(message.payload);
          } catch (error) {
            console.error("Realtime subscriber failed", error);
          }
        });
    });
  }
  disconnect() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.probeTimer);
    clearTimeout(this.connectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.scheduler.clear();
  }
}
export const realtimeClient = new RealtimeClient();
