import type { ClientMessage, Cursors } from "../topics";
import { decodeCursors } from "../topics";

/**
 * Scenario-driven mock realtime backend.
 *
 * Faults are declared per connection number, so a test reads as
 * "given this server behaviour, expect this client behaviour":
 *
 *   const server = new MockRealtimeServer({
 *     connections: { 2: { ignoreSubscribe: true } }, // backend lost state after restart
 *   });
 *
 * The core is transport-neutral: `FakeWebSocket` (in-memory, timer-driven,
 * for Vitest) and `scripts/mock-realtime-server.ts` (a real WebSocket server
 * for local runs and Playwright) both plug into it via `ServerConnection`.
 * `server.fetch` implements the long-poll contract against the same state.
 */

export interface ConnectionBehaviour {
  /** Never complete the handshake; the socket closes with this code instead. */
  refuse?: { code: number; reason?: string };
  /** Answer the first subscribe with an auth error, then close 4401. */
  rejectAuth?: boolean;
  /** Accept the connection but silently drop subscribe requests (state lost). */
  ignoreSubscribe?: boolean;
  /** After this many outbound frames, go silent without closing (half-open). */
  stallAfterFrames?: number;
  /** Delay every outbound frame by this many ms. */
  frameDelayMs?: number;
  /** After this many outbound frames, close abruptly. */
  closeAfterFrames?: { count: number; code: number; reason?: string };
}

export interface MockScenario {
  name?: string;
  /** Behaviour for specific 1-based connection numbers. */
  connections?: Record<number, ConnectionBehaviour>;
  /** Behaviour for every connection without a specific entry. */
  default?: ConnectionBehaviour;
  /** Events retained per topic for resume; older cursors get a gap. */
  replayWindow?: number;
  /** On resume, also re-send this many events at or before the cursor (at-least-once delivery). */
  resumeOverlap?: number;
}

export interface ServerConnection {
  send(text: string): void;
  close(code: number, reason: string): void;
}

interface StoredEvent {
  topic: string;
  id: string;
  seq: number;
  payload: unknown;
}

interface ConnectionState {
  number: number;
  io: ServerConnection;
  behaviour: ConnectionBehaviour;
  topics: Set<string>;
  framesSent: number;
  stalled: boolean;
  closed: boolean;
}

interface PendingPoll {
  topics: string[];
  after: Cursors;
  resolve: (res: Response) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MockRealtimeServer {
  readonly received: Array<{ connection: number; message: ClientMessage }> = [];
  private scenario: MockScenario;
  private connectionCount = 0;
  private live = new Set<ConnectionState>();
  private history = new Map<string, StoredEvent[]>();
  private seqByTopic = new Map<string, number>();
  private polls = new Set<PendingPoll>();
  /** HTTP status forced on the next long-poll requests (consumed FIFO). */
  readonly pollFaults: number[] = [];
  pollHoldMs = 25_000;

  constructor(scenario: MockScenario = {}) {
    this.scenario = scenario;
  }

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
  }

  get totalConnections(): number {
    return this.connectionCount;
  }

  get openConnections(): number {
    return this.live.size;
  }

  // ── Connection handling (used by FakeWebSocket and the node server) ─────

  /** Returns a refusal if the scenario refuses this connection, else accepts it. */
  accept(
    io: ServerConnection
  ):
    | { refused: { code: number; reason: string } }
    | { onMessage: (text: string) => void; onClose: () => void } {
    this.connectionCount += 1;
    const number = this.connectionCount;
    const behaviour = this.scenario.connections?.[number] ?? this.scenario.default ?? {};
    if (behaviour.refuse) {
      return {
        refused: { code: behaviour.refuse.code, reason: behaviour.refuse.reason ?? "refused" },
      };
    }

    const state: ConnectionState = {
      number,
      io,
      behaviour,
      topics: new Set(),
      framesSent: 0,
      stalled: false,
      closed: false,
    };
    this.live.add(state);

    return {
      onMessage: (text) => this.handleClientMessage(state, text),
      onClose: () => {
        state.closed = true;
        this.live.delete(state);
      },
    };
  }

  private handleClientMessage(state: ConnectionState, text: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(text) as ClientMessage;
    } catch {
      return;
    }
    this.received.push({ connection: state.number, message });

    if (message.type === "subscribe") {
      if (state.behaviour.rejectAuth) {
        this.sendTo(state, { type: "error", code: "auth_failed", message: "token expired" });
        this.closeConnection(state, 4401, "auth_failed");
        return;
      }
      if (state.behaviour.ignoreSubscribe) return;
      message.topics.forEach((t) => state.topics.add(t));
      const { replay, gap } = this.resume(message.topics, message.cursors ?? {});
      this.sendTo(state, {
        type: "subscribed",
        topics: message.topics,
        ...(gap.length ? { gap } : {}),
      });
      replay.forEach((event) => this.sendTo(state, event));
    } else if (message.type === "unsubscribe") {
      message.topics.forEach((t) => state.topics.delete(t));
    }
  }

  /** Events to replay from each cursor, plus topics whose cursor fell out of the window. */
  private resume(topics: string[], cursors: Cursors): { replay: StoredEvent[]; gap: string[] } {
    const replay: StoredEvent[] = [];
    const gap: string[] = [];
    const overlap = this.scenario.resumeOverlap ?? 0;
    for (const topic of topics) {
      const cursor = cursors[topic];
      if (cursor === undefined) continue;
      const events = this.history.get(topic) ?? [];
      const latest = this.seqByTopic.get(topic) ?? 0;
      const oldest = events[0]?.seq;
      if (latest > cursor && (oldest === undefined || oldest > cursor + 1)) gap.push(topic);
      replay.push(...events.filter((e) => e.seq > cursor - overlap));
    }
    return { replay, gap };
  }

  // ── Server-side controls ────────────────────────────────────────────────

  /** Publish a new event; returns it. Pass `id` to force a specific (possibly duplicate) id. */
  publish(
    topic: string,
    payload: unknown,
    opts: { id?: string; omitId?: boolean } = {}
  ): StoredEvent {
    const seq = (this.seqByTopic.get(topic) ?? 0) + 1;
    this.seqByTopic.set(topic, seq);
    const event: StoredEvent = { topic, id: opts.id ?? `${topic}-${seq}`, seq, payload };
    const list = this.history.get(topic) ?? [];
    list.push(event);
    const window = this.scenario.replayWindow ?? 1_000;
    while (list.length > window) list.shift();
    this.history.set(topic, list);

    const wire = opts.omitId ? { topic, seq, payload } : event;
    for (const state of this.live) {
      if (state.topics.has(topic)) this.sendTo(state, wire);
    }
    this.flushPolls();
    return event;
  }

  /** Re-send an already-published event (at-least-once redelivery). */
  redeliver(event: StoredEvent): void {
    for (const state of this.live) {
      if (state.topics.has(event.topic)) this.sendTo(state, event);
    }
  }

  /** Send a raw string frame to every connection (e.g. malformed input). */
  sendRaw(text: string): void {
    for (const state of this.live) this.sendTextTo(state, text);
  }

  ping(): void {
    for (const state of this.live) this.sendTo(state, { type: "ping" });
  }

  /**
   * Simulate a backend deploy: every connection closes with 1012 and all
   * subscription state is lost. With `loseHistory`, the replay buffer is
   * wiped too, so resuming clients are told about a gap.
   */
  restart(opts: { loseHistory?: boolean } = {}): void {
    for (const state of [...this.live]) this.closeConnection(state, 1012, "service restart");
    if (opts.loseHistory) this.history.clear();
  }

  /** Abruptly drop every connection with the given close code. */
  dropAll(code = 1006, reason = "abnormal closure"): void {
    for (const state of [...this.live]) this.closeConnection(state, code, reason);
  }

  private closeConnection(state: ConnectionState, code: number, reason: string): void {
    if (state.closed) return;
    state.closed = true;
    this.live.delete(state);
    state.io.close(code, reason);
  }

  private sendTo(state: ConnectionState, frame: unknown): void {
    this.sendTextTo(state, JSON.stringify(frame));
  }

  private sendTextTo(state: ConnectionState, text: string): void {
    if (state.closed || state.stalled) return;
    const { stallAfterFrames, closeAfterFrames, frameDelayMs } = state.behaviour;
    if (stallAfterFrames !== undefined && state.framesSent >= stallAfterFrames) {
      state.stalled = true;
      return;
    }
    state.framesSent += 1;
    if (frameDelayMs) setTimeout(() => !state.closed && state.io.send(text), frameDelayMs);
    else state.io.send(text);
    if (closeAfterFrames && state.framesSent >= closeAfterFrames.count) {
      const close = () =>
        this.closeConnection(state, closeAfterFrames.code, closeAfterFrames.reason ?? "");
      if (frameDelayMs) setTimeout(close, frameDelayMs);
      else close();
    }
  }

  // ── Long-poll endpoint ──────────────────────────────────────────────────

  /** A `fetch` implementing GET …/realtime/poll per the long-poll contract. */
  readonly fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://mock");
    const topics = (url.searchParams.get("topics") ?? "").split(",").filter(Boolean);
    const after = decodeCursors(url.searchParams.get("after"));
    const signal = init?.signal;

    const fault = this.pollFaults.shift();
    if (fault) return Promise.resolve(new Response(null, { status: fault }));
    const behaviour = this.scenario.default ?? {};
    if (behaviour.rejectAuth) return Promise.resolve(new Response(null, { status: 401 }));

    const { replay, gap } = this.resume(topics, after);
    const handshake = topics.filter((t) => after[t] === undefined);
    if (hasNew(replay, after) || gap.length > 0 || handshake.length > 0) {
      // Topics with no cursor start from "now", like a fresh WS subscribe.
      const cursors = Object.fromEntries(handshake.map((t) => [t, this.seqByTopic.get(t) ?? 0]));
      return Promise.resolve(this.pollResponse(replay, gap, cursors));
    }

    return new Promise<Response>((resolve, reject) => {
      const poll: PendingPoll = {
        topics,
        after: { ...after },
        resolve,
        timer: setTimeout(() => {
          this.polls.delete(poll);
          resolve(new Response(null, { status: 204 }));
        }, this.pollHoldMs),
      };
      this.polls.add(poll);
      signal?.addEventListener("abort", () => {
        clearTimeout(poll.timer);
        this.polls.delete(poll);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  };

  private flushPolls(): void {
    for (const poll of [...this.polls]) {
      const { replay } = this.resume(poll.topics, poll.after);
      if (!hasNew(replay, poll.after)) continue;
      clearTimeout(poll.timer);
      this.polls.delete(poll);
      poll.resolve(this.pollResponse(replay, [], {}));
    }
  }

  private pollResponse(events: StoredEvent[], gap: string[], cursors: Cursors): Response {
    return new Response(
      JSON.stringify({
        events,
        timeoutMs: this.pollHoldMs,
        ...(gap.length ? { gap } : {}),
        ...(Object.keys(cursors).length ? { cursors } : {}),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}

function hasNew(events: StoredEvent[], after: Cursors): boolean {
  return events.some((e) => e.seq > (after[e.topic] ?? 0));
}

/**
 * In-memory WebSocket bound to a MockRealtimeServer. Every hop (handshake,
 * send, receive, close) is a microtask, so it behaves asynchronously like a
 * real socket but never depends on timers; only scenario delays use timers.
 */
export function createFakeWebSocket(server: MockRealtimeServer) {
  return class FakeWebSocket extends EventTarget {
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    private endpoint: { onMessage: (text: string) => void; onClose: () => void } | null = null;

    constructor(readonly url: string) {
      super();
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => this.handshake());
    }

    private handshake(): void {
      if (this.readyState !== 0) return;
      const result = server.accept({
        send: (text) => queueMicrotask(() => this.deliver(text)),
        close: (code, reason) => queueMicrotask(() => this.finish(code, reason)),
      });
      if ("refused" in result) {
        this.dispatchEvent(new Event("error"));
        this.finish(result.refused.code, result.refused.reason);
        return;
      }
      this.endpoint = result;
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    }

    private deliver(text: string): void {
      if (this.readyState !== 1) return;
      this.dispatchEvent(new MessageEvent("message", { data: text }));
    }

    send(text: string): void {
      if (this.readyState !== 1) throw new Error("FakeWebSocket is not open");
      const endpoint = this.endpoint;
      queueMicrotask(() => endpoint?.onMessage(text));
    }

    close(code = 1000, reason = ""): void {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      this.endpoint?.onClose();
      queueMicrotask(() => this.finish(code, reason));
    }

    private finish(code: number, reason: string): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.endpoint?.onClose();
      this.endpoint = null;
      const event = new Event("close") as Event & { code: number; reason: string };
      Object.assign(event, { code, reason });
      this.dispatchEvent(event);
    }
  };
}
