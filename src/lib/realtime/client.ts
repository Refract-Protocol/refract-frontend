import { API_BASE_URL } from "@/lib/api/client";
import { compilePattern, TOPICS } from "./topics";
import { SessionIngress, validateEndpoint } from "./security";

type Handler = (payload: unknown) => void;
type Entry = { matches: (topic: string) => boolean; handlers: Map<symbol, Handler> };
export interface RealtimeOptions {
  url?: string;
  origin?: string;
  allowedOrigins?: readonly string[];
  capacity?: number;
  topics?: readonly string[];
  socket?: (url: string) => WebSocket;
}
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private entries = new Map<string, Entry>();
  private server = new Set<string>();
  private pending = new Map<string, (topic: string) => boolean>();
  private ingress: SessionIngress | null = null;
  private wildcard = false;
  private credential: string | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  get teardownVersion(): number {
    return this.generation;
  }
  readonly diagnostics = { rejected: 0, overflow: 0, transport: 0, breadcrumbs: [] as string[] };
  constructor(private options: RealtimeOptions = {}) {
    if (
      !Number.isSafeInteger(options.capacity ?? 256) ||
      (options.capacity ?? 256) < 1 ||
      (options.capacity ?? 256) > 4096
    )
      throw new Error("Invalid realtime capacity");
    if ((options.topics?.length ?? 0) > 4096)
      throw new Error("Realtime topic catalog capacity exceeded");
    options.topics?.forEach((topic) => {
      compilePattern(topic);
      if (topic.includes("*")) throw new Error("Catalog topics must be concrete");
    });
  }
  private diagnostic(kind: "rejected" | "overflow" | "transport") {
    this.diagnostics[kind]++;
    this.diagnostics.breadcrumbs.push(`realtime:${kind}`);
    if (this.diagnostics.breadcrumbs.length > 20) this.diagnostics.breadcrumbs.shift();
  }
  connect(): void {
    if (this.socket || this.timer || (typeof WebSocket === "undefined" && !this.options.socket))
      return;
    let url: URL;
    try {
      url = validateEndpoint(
        this.options.url ?? API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws"),
        this.options.origin ?? window.location.origin,
        this.options.allowedOrigins ??
          (process.env.NEXT_PUBLIC_REALTIME_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)
      );
    } catch {
      this.diagnostic("rejected");
      return;
    }
    const generation = this.generation;
    let socket: WebSocket;
    try {
      socket = (this.options.socket ?? ((u) => new WebSocket(u)))(url.href);
    } catch {
      this.diagnostic("transport");
      this.retry(generation);
      return;
    }
    this.socket = socket;
    const challenge = crypto.randomUUID();
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      if (!this.send({ type: "auth", version: 1, challenge, credential: this.credential })) return;
      this.handshakeTimer = setTimeout(() => {
        if (!this.ingress) socket.close();
      }, 10_000);
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      try {
        if (typeof event.data !== "string" || event.data.length > 1_000_000) throw new Error();
        const frame = JSON.parse(event.data) as Record<string, unknown>;
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new Error();
        if (!this.ingress) {
          if (
            frame.type !== "authenticated" ||
            frame.version !== 1 ||
            frame.challenge !== challenge ||
            typeof frame.session !== "string" ||
            frame.session.length < 16 ||
            frame.session.length > 200 ||
            typeof frame.wildcards !== "boolean" ||
            !Array.isArray(frame.topics) ||
            frame.topics.length >
              (this.options.capacity ?? 256) + (this.options.topics ?? TOPICS).length ||
            !frame.topics.every((t) => typeof t === "string" && !!compilePattern(t))
          )
            throw new Error();
          this.ingress = new SessionIngress(frame.session);
          this.wildcard = frame.wildcards;
          this.server = new Set(frame.topics as string[]);
          this.attempt = 0;
          if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
          this.flush();
          return;
        }
        if (!this.ingress.accept(frame)) throw new Error();
        if (
          typeof frame.topic !== "string" ||
          !Object.prototype.hasOwnProperty.call(frame, "payload") ||
          frame.topic.includes("*")
        )
          throw new Error();
        compilePattern(frame.topic);
        this.entries.forEach((entry) => {
          if (entry.matches(frame.topic as string))
            entry.handlers.forEach((handler) => {
              try {
                handler(frame.payload);
              } catch {
                /* Isolate consumers. */
              }
            });
        });
      } catch {
        this.diagnostic("rejected");
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ingress = null;
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.retry(generation);
    });
    socket.addEventListener("error", () => socket.close());
  }
  private retry(generation: number) {
    if (generation !== this.generation || this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.connect();
      },
      Math.min(1000 * 2 ** this.attempt++, 30000)
    );
  }
  private send(frame: unknown): boolean {
    try {
      if (this.socket?.readyState !== 1) return false;
      this.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      this.diagnostic("transport");
      this.socket?.close();
      return false;
    }
  }
  /** Latest authentication intent supersedes earlier credentials; always precedes topics. */
  authenticate(credential: string | null): void {
    this.credential = credential;
    this.ingress = null;
    const socket = this.socket;
    this.socket = null;
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    socket?.close();
    this.connect();
  }
  private record(pattern: string, matches: (topic: string) => boolean): void {
    if (!this.pending.has(pattern) && this.pending.size >= (this.options.capacity ?? 256)) {
      // Preserve desired state; overflow falls back to a full reconciliation.
      this.diagnostic("overflow");
      this.pending.clear();
    }
    this.pending.set(pattern, matches);
  }
  subscribe(pattern: string, handler: Handler): () => void {
    const matches = compilePattern(pattern);
    let entry = this.entries.get(pattern);
    if (!entry) {
      if (this.entries.size >= (this.options.capacity ?? 256)) {
        this.diagnostic("overflow");
        throw new Error("Realtime subscription capacity exceeded");
      }
      entry = { matches, handlers: new Map() };
      this.entries.set(pattern, entry);
      this.record(pattern, matches);
    }
    const id = Symbol();
    entry.handlers.set(id, handler);
    this.connect();
    this.flush();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      // Old teardown callbacks must not touch subscriptions created after logout.
      if (this.entries.get(pattern) !== entry) return;
      entry.handlers.delete(id);
      if (!entry.handlers.size) {
        this.entries.delete(pattern);
        if ([...this.server].some((topic) => topic === pattern || entry.matches(topic)))
          this.record(pattern, entry.matches);
        else this.pending.delete(pattern);
        this.flush();
      }
    };
  }
  private flush() {
    if (!this.ingress) return;
    const desired = new Set<string>();
    this.entries.forEach((entry, pattern) => {
      if (this.wildcard || !pattern.includes("*")) desired.add(pattern);
      else
        (this.options.topics ?? TOPICS).forEach((topic) => {
          if (entry.matches(topic)) desired.add(topic);
        });
    });
    // Queue and resume use one diff, so a topic can produce at most one mutation.
    const mutations = new Map<string, "subscribe" | "unsubscribe">();
    for (const topic of this.server) if (!desired.has(topic)) mutations.set(topic, "unsubscribe");
    for (const topic of desired) if (!this.server.has(topic)) mutations.set(topic, "subscribe");
    const apply = (topic: string): boolean => {
      const type = mutations.get(topic)!;
      if (!this.send({ type, topic })) return false;
      if (type === "subscribe") this.server.add(topic);
      else this.server.delete(topic);
      mutations.delete(topic);
      return true;
    };
    for (const [pattern, matches] of this.pending) {
      for (const topic of mutations.keys())
        if (topic === pattern || matches(topic)) {
          if (!apply(topic)) return;
        }
    }
    // Unrequested resumed interests have no local ordering history.
    for (const topic of mutations.keys()) if (!apply(topic)) return;
    this.pending.clear();
  }
  disconnect(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    this.ingress = null;
    this.credential = null;
    this.entries.clear();
    this.pending.clear();
    this.server.clear();
    socket?.close();
  }
}
export const realtimeClient = new RealtimeClient();
