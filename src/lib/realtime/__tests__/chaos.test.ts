import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient, type GapInfo, type RealtimeClientOptions } from "../client";
import { FrameDecoder } from "../frameDecoder";
import { MockRealtimeServer, createFakeWebSocket, type MockScenario } from "../testing/mockServer";
import { LongPollTransport } from "../transports/longPoll";
import type { TransportFactory } from "../transports/types";
import { WebSocketTransport } from "../transports/websocket";

/**
 * Chaos / failure-injection scenarios. Each test declares a server
 * behaviour and asserts the client's recovery. Everything runs on fake
 * timers, so there are no wall-clock waits and no flakiness.
 *
 * Run just these with `npm run test:chaos`.
 */

const TOPIC = "oracle_update";
const OPTS: RealtimeClientOptions = {
  backoffBaseMs: 1_000,
  backoffMaxMs: 8_000,
  idleTimeoutMs: 30_000,
  subscribeAckTimeoutMs: 5_000,
  maxSubscribeAttempts: 3,
  degradedRetryMs: 60_000,
};

function wsFactory(server: MockRealtimeServer, supported = true): TransportFactory {
  const FakeWebSocket = createFakeWebSocket(server);
  return {
    kind: "websocket",
    isSupported: () => supported,
    create: () =>
      new WebSocketTransport({
        url: "ws://mock/ws",
        WebSocketImpl: FakeWebSocket as unknown as new (url: string) => WebSocket,
      }),
  };
}

function longPollFactory(server: MockRealtimeServer): TransportFactory {
  return {
    kind: "long-poll",
    isSupported: () => true,
    create: () =>
      new LongPollTransport({
        url: "http://mock/api/v1/realtime/poll",
        fetchImpl: server.fetch,
        visibility: null,
      }),
  };
}

function setup(scenario: MockScenario = {}, extra: Partial<RealtimeClientOptions> = {}) {
  const server = new MockRealtimeServer(scenario);
  const client = new RealtimeClient({
    transports: [wsFactory(server)],
    decoder: new FrameDecoder({ createWorker: () => null }),
    ...OPTS,
    ...extra,
  });
  const received: Array<{ id?: string; seq?: number; payload: unknown }> = [];
  const gaps: GapInfo[] = [];
  const statuses: string[] = [];
  client.onStatusChange((s) => statuses.push(s));
  client.subscribe(
    TOPIC,
    (payload, meta) => received.push({ id: meta.id, seq: meta.seq, payload }),
    (g) => gaps.push(g)
  );
  return { server, client, received, gaps, statuses, ids: () => received.map((r) => r.id) };
}

/** Advance fake time, then let the fake socket's microtask hops settle. */
async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe("realtime chaos scenarios", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("baseline: connects, subscribes and receives events", async () => {
    const { server, client, ids } = setup();
    await tick();
    expect(client.status).toBe("open");
    expect(server.received[0]).toEqual({
      connection: 1,
      message: { type: "subscribe", topics: [TOPIC], cursors: {} },
    });
    server.publish(TOPIC, { value: 1 });
    server.publish(TOPIC, { value: 2 });
    await tick();
    expect(ids()).toEqual(["oracle_update-1", "oracle_update-2"]);
    expect(client.getStats().transport).toBe("websocket");
  });

  describe("fault: abrupt close", () => {
    it.each([1006, 1011, 1001])(
      "reconnects after close code %i and resumes from the cursor",
      async (code) => {
        const { server, client, ids, statuses } = setup();
        await tick();
        server.publish(TOPIC, 1);
        await tick();

        server.dropAll(code);
        await tick();
        expect(client.status).toBe("reconnecting");
        server.publish(TOPIC, 2); // published while the client is away
        await tick(999);
        expect(server.totalConnections).toBe(1);
        await tick(1);
        expect(server.totalConnections).toBe(2);
        await tick();

        expect(client.status).toBe("open");
        expect(server.received.at(-1)).toEqual({
          connection: 2,
          message: { type: "subscribe", topics: [TOPIC], cursors: { [TOPIC]: 1 } },
        });
        expect(ids()).toEqual(["oracle_update-1", "oracle_update-2"]);
        expect(statuses).toEqual(["connecting", "open", "reconnecting", "open"]);
      }
    );

    it("backs off exponentially while the server stays down, then recovers", async () => {
      const { server, client } = setup({
        connections: { 2: { refuse: { code: 1006 } }, 3: { refuse: { code: 1006 } } },
      });
      await tick();
      server.dropAll();
      await tick(1_000); // attempt 2 at +1s: refused
      expect(server.totalConnections).toBe(2);
      await tick(1_999);
      expect(server.totalConnections).toBe(2);
      await tick(1); // attempt 3 at +2s: refused
      expect(server.totalConnections).toBe(3);
      await tick(4_000); // attempt 4 at +4s: accepted
      expect(server.totalConnections).toBe(4);
      expect(client.status).toBe("open");
      expect(client.getStats().reconnects).toBe(3);
    });
  });

  describe("fault: backend restart", () => {
    it("re-subscribes after a restart and drops the replayed overlap as duplicates", async () => {
      const { server, client, ids } = setup({ resumeOverlap: 2 });
      await tick();
      server.publish(TOPIC, 1);
      server.publish(TOPIC, 2);
      await tick();

      server.restart();
      server.publish(TOPIC, 3);
      await tick(1_000);
      await tick();

      expect(client.status).toBe("open");
      // Server replayed 1, 2 (overlap) and 3; only 3 is new.
      expect(ids()).toEqual(["oracle_update-1", "oracle_update-2", "oracle_update-3"]);
      expect(client.getStats().dedupe.duplicatesDropped).toBe(2);
    });

    it("resume succeeds but reports a gap when the replay buffer was lost", async () => {
      const { server, client, gaps, ids } = setup();
      await tick();
      server.publish(TOPIC, 1);
      await tick();

      server.restart({ loseHistory: true });
      server.publish(TOPIC, 2);
      server.restart({ loseHistory: true }); // event 2 is gone before we reconnect
      await tick(1_000);
      await tick();
      expect(server.totalConnections).toBe(2);
      await tick(2_000);
      await tick();

      expect(client.status).toBe("open");
      expect(gaps).toEqual([{ topic: TOPIC, reason: "resume" }]);
      expect(client.getStats().resumeGaps).toBe(1);
      expect(ids()).toEqual(["oracle_update-1"]);

      // Live events continue after the gap.
      server.publish(TOPIC, 3);
      await tick();
      expect(ids()).toEqual(["oracle_update-1", "oracle_update-3"]);
    });
  });

  describe("fault: half-open connection", () => {
    it("detects a stalled socket via the idle timeout and reconnects", async () => {
      const { server, client, ids } = setup({ connections: { 1: { stallAfterFrames: 2 } } });
      await tick();
      server.publish(TOPIC, 1); // frame 2 (frame 1 was the ack)
      server.publish(TOPIC, 2); // swallowed: socket is now half-open
      await tick(29_999);
      expect(server.totalConnections).toBe(1);
      await tick(1);
      expect(client.getStats().idleTimeouts).toBe(1);
      await tick(1_000);
      await tick();
      expect(server.totalConnections).toBe(2);
      expect(client.status).toBe("open");
      // Resume from cursor 1 recovers the swallowed event.
      expect(ids()).toEqual(["oracle_update-1", "oracle_update-2"]);
    });

    it("server pings keep a quiet connection alive", async () => {
      const { server, client } = setup();
      await tick();
      for (let i = 0; i < 5; i++) {
        await tick(20_000);
        server.ping();
      }
      await tick();
      expect(client.getStats().idleTimeouts).toBe(0);
      expect(server.received.filter((r) => r.message.type === "pong")).toHaveLength(5);
    });
  });

  describe("fault: slow / delayed frames", () => {
    it("tolerates delayed frames without reordering or false idle timeouts", async () => {
      const { server, client, received } = setup({ default: { frameDelayMs: 4_000 } });
      await tick(4_000);
      for (let i = 1; i <= 5; i++) server.publish(TOPIC, i);
      await tick(4_000);
      expect(received.map((r) => r.payload)).toEqual([1, 2, 3, 4, 5]);
      expect(client.getStats().idleTimeouts).toBe(0);
      expect(client.status).toBe("open");
    });

    it("tolerates a delayed subscribe acknowledgement", async () => {
      const { client } = setup({ default: { frameDelayMs: 4_900 } });
      await tick(5_000);
      expect(client.getStats().subscribeRetries).toBe(0);
      expect(client.status).toBe("open");
    });
  });

  describe("fault: dropped subscribes after reconnect", () => {
    it("retries the subscribe, then degrades to REST, then recovers later", async () => {
      const { server, client, ids } = setup({ connections: { 2: { ignoreSubscribe: true } } });
      await tick();
      server.dropAll();
      await tick(1_000);
      await tick();
      expect(client.status).toBe("open");

      await tick(5_000); // 1st ack timeout → resend
      expect(client.getStats().subscribeRetries).toBe(1);
      expect(server.received.filter((r) => r.connection === 2)).toHaveLength(2);
      await tick(5_000); // 2nd → resend
      await tick(5_000); // 3rd → give up
      expect(client.status).toBe("degraded");
      expect(client.getStats().degradedReason).toBe("subscribe_timeout");

      await tick(60_000); // periodic retry from degraded
      await tick();
      expect(server.totalConnections).toBe(3);
      expect(client.status).toBe("open");
      server.publish(TOPIC, "back");
      await tick();
      expect(ids()).toEqual(["oracle_update-1"]);
    });

    it("recovers without degrading when a retried subscribe is acknowledged", async () => {
      const { server, client } = setup();
      await tick();
      // The server forgets the subscription once (lost on its side), then recovers.
      server.setScenario({ connections: { 2: { ignoreSubscribe: true } } });
      server.dropAll();
      await tick(1_000);
      await tick();
      server.setScenario({});
      server.dropAll();
      await tick(1_000);
      await tick();
      expect(client.status).toBe("open");
      expect(client.getStats().degradedReason).toBeNull();
    });
  });

  describe("fault: auth rejected on reconnect", () => {
    it("stops reconnecting and degrades to REST until the session is reset", async () => {
      const { server, client } = setup({ connections: { 2: { rejectAuth: true } } });
      await tick();
      server.dropAll();
      await tick(1_000);
      await tick();

      expect(client.status).toBe("degraded");
      expect(client.getStats().degradedReason).toBe("auth");
      await tick(10 * 60_000);
      expect(server.totalConnections).toBe(2); // no retry storm against a rejecting backend

      client.resetSession(); // e.g. user reconnected their wallet
      await tick();
      expect(server.totalConnections).toBe(3);
      expect(client.status).toBe("open");
    });

    it("treats a 4401 close without an error frame as an auth failure", async () => {
      const { server, client } = setup();
      await tick();
      server.dropAll(4401, "unauthorized");
      await tick();
      expect(client.status).toBe("degraded");
      expect(client.getStats().degradedReason).toBe("auth");
    });
  });

  describe("fault: transport unavailable", () => {
    it("falls back from a refusing WebSocket to long-poll and records the winner", async () => {
      const server = new MockRealtimeServer({ default: { refuse: { code: 1006 } } });
      const client = new RealtimeClient({
        transports: [wsFactory(server), longPollFactory(server)],
        decoder: new FrameDecoder({ createWorker: () => null }),
        ...OPTS,
        maxOpenFailuresPerTransport: 2,
      });
      const ids: string[] = [];
      client.subscribe(TOPIC, (_p, meta) => ids.push(meta.id!));
      await tick(); // WS attempt 1 refused
      await tick(1_000); // WS attempt 2 refused → switch tier immediately
      await tick(10); // let the long-poll handshake response body stream in
      expect(client.status).toBe("open");
      expect(client.getStats().transport).toBe("long-poll");
      expect(client.getStats().negotiation).toEqual([
        { kind: "websocket", outcome: "failed" },
        { kind: "long-poll", outcome: "selected" },
      ]);
      server.publish(TOPIC, 1);
      await tick(10);
      expect(ids).toEqual(["oracle_update-1"]);
      client.disconnect();
    });

    it("degrades to REST polling when no transport is supported", async () => {
      const server = new MockRealtimeServer();
      const client = new RealtimeClient({ transports: [wsFactory(server, false)], ...OPTS });
      client.subscribe(TOPIC, () => {});
      expect(client.status).toBe("degraded");
      expect(client.getStats().degradedReason).toBe("no_transport");
      expect(client.getStats().negotiation).toEqual([
        { kind: "websocket", outcome: "unsupported" },
      ]);
      client.disconnect();
    });
  });

  describe("fault: bad and duplicate frames", () => {
    it("counts malformed frames and keeps the connection", async () => {
      const { server, client, ids } = setup();
      await tick();
      server.sendRaw("{garbage");
      server.sendRaw(JSON.stringify({ topic: TOPIC, seq: -4, payload: 1 }));
      server.publish(TOPIC, 1);
      await tick();
      expect(client.getStats().decodeErrors).toEqual({
        too_large: 0,
        invalid_json: 1,
        invalid_shape: 1,
      });
      expect(ids()).toEqual(["oracle_update-1"]);
      expect(client.status).toBe("open");
    });

    it("drops at-least-once redeliveries and passes id-less events through", async () => {
      const { server, client, received } = setup();
      await tick();
      const first = server.publish(TOPIC, 1);
      server.redeliver(first);
      server.redeliver(first);
      server.publish(TOPIC, 2, { omitId: true });
      await tick();
      expect(received.map((r) => r.payload)).toEqual([1, 2]);
      expect(client.getStats().dedupe).toMatchObject({ duplicatesDropped: 2, missingId: 1 });
    });

    it("reports a sequence gap when events are skipped mid-stream", async () => {
      const { server, gaps } = setup();
      await tick();
      server.publish(TOPIC, 1);
      server.sendRaw(JSON.stringify({ topic: TOPIC, id: "late", seq: 5, payload: 5 }));
      await tick();
      expect(gaps).toEqual([{ topic: TOPIC, reason: "sequence" }]);
    });
  });

  it("replaying a recorded stream twice applies each event exactly once", async () => {
    const { server, client, received } = setup();
    await tick();
    const recorded = Array.from({ length: 20 }, (_, i) => server.publish(TOPIC, i));
    recorded.forEach((e) => server.redeliver(e));
    await tick();
    expect(received.map((r) => r.payload)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(client.getStats().dedupe.duplicatesDropped).toBe(20);
  });

  it("resetSession forgets dedupe state and cursors (account/network switch)", async () => {
    const { server, client, received } = setup();
    await tick();
    const event = server.publish(TOPIC, 1);
    await tick();
    expect(client.getCursors()).toEqual({ [TOPIC]: 1 });

    client.resetSession();
    await tick();
    expect(client.getCursors()).toEqual({});
    expect(server.received.at(-1)?.message).toEqual({
      type: "subscribe",
      topics: [TOPIC],
      cursors: {},
    });
    server.redeliver(event); // same id, new identity: must not be suppressed
    await tick();
    expect(received).toHaveLength(2);
  });
});
