import { API_BASE_URL } from "../api/client";
import { ClaimRecordSchema, OracleReadingSchema, PoolStatsSchema } from "./generated";
import type { RealtimePayloads, RealtimeTopic } from "./types";

type Handler = (payload: unknown) => void;
type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_PENDING_TOPICS = 500;
const CHANNEL = `${process.env.NEXT_PUBLIC_APP_INSTANCE ?? "refract"}-realtime-v1`;
const LEASE_KEY = `${CHANNEL}-leader`;
const LEASE_MS = 4_000;
const HEARTBEAT_MS = 1_000;
type WireMessage = { topic: string; payload: unknown };
type Operation = { topic: string; op: "subscribe" | "unsubscribe" };
type TabEnvelope = {
  version: 1;
  instance: string;
  sender: string;
  kind: "event" | "state" | "control";
  seq: number;
  topic?: string;
  payload?: unknown;
  state?: ConnectionState;
  operations?: Operation[];
};

/** Reconnecting topic client with a bounded outbound microtask queue and cross-tab fan-out. */
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private pending = new Map<string, "subscribe" | "unsubscribe">();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushScheduled = false;
  private channel: BroadcastChannel | null = null;
  private tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private leader = true;
  private usesWebLocks = false;
  private releaseLeaderLock: (() => void) | null = null;
  private electionTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private lastSequence = new Map<string, number>();
  private followerTopics = new Map<string, Set<string>>();
  private state: ConnectionState = "disconnected";
  private stateHandlers = new Set<(state: ConnectionState) => void>();

  connect(): void {
    if (typeof WebSocket === "undefined" || this.closedByUser) return;
    this.startTabCoordination();
    if (this.channel && !this.leader) return;
    if (!this.socket) this.open();
  }

  private startTabCoordination(): void {
    if (
      this.channel ||
      typeof BroadcastChannel === "undefined" ||
      typeof localStorage === "undefined"
    )
      return;
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (event: MessageEvent<unknown>) => this.receiveTabMessage(event.data);
      this.usesWebLocks = typeof navigator !== "undefined" && !!navigator.locks;
      this.leader = this.usesWebLocks ? false : this.claimLeadership();
      if (this.usesWebLocks) void this.acquireLeaderLock();
      this.electionTimer = setInterval(() => {
        const wasLeader = this.leader;
        if (wasLeader) this.writeLease();
        else if (this.usesWebLocks) void this.acquireLeaderLock();
        else this.leader = this.claimLeadership();
        if (!wasLeader && this.leader) {
          this.flush();
          this.open();
          this.resubscribeAll();
        }
        if (wasLeader && !this.leader) this.socket?.close();
      }, HEARTBEAT_MS);
      if (this.leader) this.writeLease();
    } catch {
      this.channel?.close();
      this.channel = null;
      this.leader = true;
    }
  }

  private acquireLeaderLock(): void {
    if (!this.usesWebLocks || this.leader || this.closedByUser) return;
    let acquired = false;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    void navigator.locks
      .request(CHANNEL, { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        acquired = true;
        this.releaseLeaderLock = release;
        this.leader = true;
        this.writeLease();
        this.open();
        this.resubscribeAll();
        await hold;
      })
      .then(() => {
        if (!acquired) return;
        this.releaseLeaderLock = null;
        this.leader = false;
      })
      .catch(() => {
        this.usesWebLocks = false;
        this.leader = this.claimLeadership();
        if (this.leader) this.open();
      });
  }

  private claimLeadership(): boolean {
    try {
      const lease = JSON.parse(localStorage.getItem(LEASE_KEY) || "null") as {
        id?: string;
        expires?: number;
      } | null;
      if (!lease || !lease.expires || lease.expires < Date.now() || lease.id === this.tabId) {
        this.writeLease();
        return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  private writeLease(): void {
    try {
      localStorage.setItem(
        LEASE_KEY,
        JSON.stringify({ id: this.tabId, expires: Date.now() + LEASE_MS })
      );
    } catch {
      /* storage may be disabled */
    }
  }

  private receiveTabMessage(raw: unknown): void {
    if (!raw || typeof raw !== "object") {
      console.warn("Ignored malformed realtime tab message");
      return;
    }
    const msg = raw as Partial<TabEnvelope>;
    if (
      msg.version !== 1 ||
      msg.instance !== CHANNEL ||
      typeof msg.sender !== "string" ||
      !Number.isSafeInteger(msg.seq) ||
      (msg.kind !== "event" && msg.kind !== "state" && msg.kind !== "control")
    ) {
      console.warn("Ignored malformed realtime tab message");
      return;
    }
    if (msg.sender === this.tabId || (this.lastSequence.get(msg.sender!) ?? 0) >= msg.seq!) return;
    try {
      if (JSON.stringify(raw).length > 65_536) {
        console.warn("Ignored oversized realtime tab message");
        return;
      }
    } catch {
      return;
    }
    if (msg.kind === "event" && (typeof msg.topic !== "string" || !Object.hasOwn(msg, "payload"))) {
      console.warn("Ignored malformed realtime tab message");
      return;
    }
    if (
      msg.kind === "state" &&
      !["connecting", "connected", "reconnecting", "disconnected"].includes(String(msg.state))
    ) {
      console.warn("Ignored malformed realtime tab message");
      return;
    }
    this.lastSequence.set(msg.sender!, msg.seq!);
    if (
      msg.kind === "control" &&
      (!Array.isArray(msg.operations) ||
        msg.operations.length > MAX_PENDING_TOPICS ||
        !msg.operations.every(
          (op) =>
            op && typeof op.topic === "string" && (op.op === "subscribe" || op.op === "unsubscribe")
        ))
    ) {
      console.warn("Ignored malformed realtime tab message");
      return;
    }
    if (msg.kind === "event" && typeof msg.topic === "string")
      this.dispatch(msg.topic, msg.payload);
    if (
      msg.kind === "state" &&
      ["connecting", "connected", "reconnecting", "disconnected"].includes(String(msg.state))
    ) {
      this.setState(msg.state as ConnectionState, false);
      if (msg.state === "connecting" && !this.leader) this.resubscribeAll();
    }
    if (
      msg.kind === "control" &&
      this.leader &&
      Array.isArray(msg.operations) &&
      msg.operations.length <= MAX_PENDING_TOPICS &&
      msg.operations.every(
        (op) =>
          op && typeof op.topic === "string" && (op.op === "subscribe" || op.op === "unsubscribe")
      )
    ) {
      const topics = this.followerTopics.get(msg.sender!) ?? new Set<string>();
      for (const { topic, op } of msg.operations) {
        const previouslyNeeded = this.handlers.get(topic)?.size
          ? true
          : [...this.followerTopics.values()].some((set) => set.has(topic));
        if (op === "subscribe") topics.add(topic);
        else topics.delete(topic);
        const nowNeeded = this.handlers.get(topic)?.size
          ? true
          : [...this.followerTopics.values()].some((set) => set.has(topic)) || topics.has(topic);
        if (previouslyNeeded !== nowNeeded)
          this.enqueue(topic, nowNeeded ? "subscribe" : "unsubscribe");
      }
      if (topics.size) this.followerTopics.set(msg.sender!, topics);
      else this.followerTopics.delete(msg.sender!);
      this.flush();
    }
  }

  private broadcast(message: Omit<TabEnvelope, "version" | "instance" | "sender" | "seq">): void {
    if (!this.channel) return;
    try {
      this.channel.postMessage({
        ...message,
        version: 1,
        instance: CHANNEL,
        sender: this.tabId,
        seq: ++this.sequence,
      } satisfies TabEnvelope);
    } catch {
      /* oversized/uncloneable payload */
    }
  }

  private open(): void {
    if (this.socket || (this.channel && !this.leader)) return;
    this.setState(this.attempt ? "reconnecting" : "connecting");
    const wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
    try {
      this.socket = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket.addEventListener("open", () => {
      this.attempt = 0;
      this.setState("connected");
      this.flush();
      this.resubscribeAll();
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WireMessage;
        if (typeof msg.topic !== "string" || !Object.hasOwn(msg, "payload")) return;
        this.dispatch(msg.topic, msg.payload);
        this.broadcast({ kind: "event", topic: msg.topic, payload: msg.payload });
      } catch {
        /* Ignore malformed server messages. */
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.closedByUser) {
        this.setState("reconnecting");
        this.scheduleReconnect();
      } else this.setState("disconnected");
    });
    this.socket.addEventListener("error", () => this.socket?.close());
  }

  private dispatch(topic: string, payload: unknown): void {
    const schemas = {
      oracle_update: OracleReadingSchema,
      claim_update: ClaimRecordSchema,
      pool_update: PoolStatsSchema,
    };
    if (!Object.hasOwn(schemas, topic)) return;
    const result = schemas[topic as RealtimeTopic].safeParse(payload);
    if (!result.success) {
      console.warn(`Ignored malformed realtime payload for ${topic}`);
      return;
    }
    this.handlers.get(topic)?.forEach((handler) => handler(result.data));
  }
  private setState(state: ConnectionState, fanout = true): void {
    this.state = state;
    this.stateHandlers.forEach((handler) => handler(state));
    if (fanout) this.broadcast({ kind: "state", state });
  }
  getConnectionState(): ConnectionState {
    return this.state;
  }
  onConnectionState(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private enqueue(topic: string, operation: "subscribe" | "unsubscribe"): void {
    const previous = this.pending.get(topic);
    if (previous === "subscribe" && operation === "unsubscribe") {
      this.pending.delete(topic);
      return;
    }
    if (!this.pending.has(topic) && this.pending.size >= MAX_PENDING_TOPICS) {
      const oldest = this.pending.keys().next().value as string | undefined;
      if (oldest) this.pending.delete(oldest);
      console.warn("Realtime outbound queue full; dropped oldest topic operation");
    }
    this.pending.delete(topic);
    this.pending.set(topic, operation);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flushScheduled = false;
        this.flush();
      });
    }
  }

  /** Flush queued subscription operations in a single frame; safe to call before disconnect. */
  flush(): void {
    if (!this.pending.size) return;
    const operations = [...this.pending].map(([topic, op]) => ({ topic, op }));
    if (this.channel && !this.leader) {
      this.pending.clear();
      this.broadcast({ kind: "control", operations });
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.pending.clear();
    try {
      this.socket.send(JSON.stringify({ type: "batch", operations }));
    } catch {
      operations.forEach(({ topic, op }) => {
        if (!this.pending.has(topic)) this.pending.set(topic, op);
      });
    }
  }

  /** Send boundary-sensitive frames (for example authentication) immediately. */
  sendImmediately(frame: unknown): void {
    this.flush();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  private resubscribeAll(): void {
    this.handlers.forEach((handlers, topic) => {
      if (handlers.size) this.enqueue(topic, "subscribe");
    });
    if (this.leader)
      this.followerTopics.forEach((topics) =>
        topics.forEach((topic) => this.enqueue(topic, "subscribe"))
      );
    this.flush();
  }

  subscribe<Topic extends RealtimeTopic>(
    topic: Topic,
    handler: (payload: RealtimePayloads[Topic]) => void
  ): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    const handlers = this.handlers.get(topic)!;
    if (handlers.size === 0 && ![...this.followerTopics.values()].some((set) => set.has(topic)))
      this.enqueue(topic, "subscribe");
    handlers.add(handler as Handler);
    this.connect();
    return () => {
      const current = this.handlers.get(topic);
      current?.delete(handler as Handler);
      if (current?.size === 0) {
        this.handlers.delete(topic);
        if (![...this.followerTopics.values()].some((set) => set.has(topic)))
          this.enqueue(topic, "unsubscribe");
      }
    };
  }

  disconnect(): void {
    this.flush();
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.electionTimer) clearInterval(this.electionTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.leader) {
      try {
        localStorage.removeItem(LEASE_KEY);
      } catch {
        /* ignore */
      }
    }
    this.releaseLeaderLock?.();
    this.releaseLeaderLock = null;
    this.channel?.close();
    this.channel = null;
    this.socket?.close();
    this.socket = null;
    this.setState("disconnected");
  }
}

export const realtimeClient = new RealtimeClient();
