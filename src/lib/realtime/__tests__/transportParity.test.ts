// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { RealtimeClient, type EventMeta } from "../client";
import { FrameDecoder } from "../frameDecoder";
import { MockRealtimeServer, createFakeWebSocket } from "../testing/mockServer";
import { LongPollTransport } from "../transports/longPoll";
import type { TransportFactory } from "../transports/types";
import { WebSocketTransport } from "../transports/websocket";

/**
 * Contract test: whichever transport wins negotiation, a component using
 * useRealtimeTopic sees exactly the same event stream: same events, same
 * order, each applied once, even when the server re-delivers.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TOPIC = "claim_settled";

type Seen = { payload: unknown; id?: string; seq?: number };

function transportFor(
  kind: "websocket" | "long-poll",
  server: MockRealtimeServer
): TransportFactory {
  if (kind === "websocket") {
    const FakeWebSocket = createFakeWebSocket(server);
    return {
      kind,
      isSupported: () => true,
      create: () =>
        new WebSocketTransport({
          url: "ws://mock/ws",
          WebSocketImpl: FakeWebSocket as unknown as new (url: string) => WebSocket,
        }),
    };
  }
  return {
    kind,
    isSupported: () => true,
    create: () =>
      new LongPollTransport({
        url: "http://mock/realtime/poll",
        fetchImpl: server.fetch,
        visibility: null,
      }),
  };
}

async function settle(ms = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });
}

async function recordStream(kind: "websocket" | "long-poll") {
  // At-least-once delivery: every resume re-sends the last two events.
  const server = new MockRealtimeServer({ resumeOverlap: 2 });
  const client = new RealtimeClient({
    transports: [transportFor(kind, server)],
    decoder: new FrameDecoder({ createWorker: () => null }),
    idleTimeoutMs: 0,
  });
  const seen: Seen[] = [];
  const latest: unknown[] = [];

  function Probe() {
    const { latest: value } = useRealtimeTopic<{ claim: number }>(TOPIC, {
      client,
      onEvent: (payload, meta: EventMeta) => seen.push({ payload, id: meta.id, seq: meta.seq }),
    });
    latest.push(value);
    return null;
  }

  const container = document.createElement("div");
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  await settle();
  expect(client.status).toBe("open");

  for (let claim = 1; claim <= 3; claim++) {
    server.publish(TOPIC, { claim });
    await settle();
  }
  server.restart(); // drops WS connections; long-poll simply polls again
  await settle(1_000);
  await settle();
  for (let claim = 4; claim <= 5; claim++) {
    server.publish(TOPIC, { claim });
    await settle();
  }

  await act(async () => root.unmount());
  client.disconnect();
  return { seen, lastRendered: latest.at(-1), stats: client.getStats() };
}

describe("transport parity: WebSocket vs long-poll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers an identical, de-duplicated event stream to the hook", async () => {
    const ws = await recordStream("websocket");
    const lp = await recordStream("long-poll");

    const expected = [1, 2, 3, 4, 5].map((claim) => ({
      payload: { claim },
      id: `${TOPIC}-${claim}`,
      seq: claim,
    }));
    expect(ws.seen).toEqual(expected);
    expect(lp.seen).toEqual(ws.seen);
    expect(lp.lastRendered).toEqual(ws.lastRendered);
    expect(ws.lastRendered).toEqual({ claim: 5 });

    // Both paths really were exposed to re-delivery and both suppressed it.
    expect(ws.stats.dedupe.duplicatesDropped).toBeGreaterThan(0);
    expect(lp.stats.dedupe.duplicatesDropped).toBeGreaterThan(0);
    expect(ws.stats.transport).toBe("websocket");
    expect(lp.stats.transport).toBe("long-poll");
  });
});
