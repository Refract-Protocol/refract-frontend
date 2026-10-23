import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./client";
import type { RealtimeError } from "./errors";
import type { RealtimeBreadcrumb, RealtimeErrorContext, RealtimeReporter } from "./reporter";
import { fakeSocketFactory } from "./testing/fakeSocket";

const ACCOUNT_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ACCOUNT_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const READING = {
  coverageType: "StablecoinDepeg",
  type: "oracle_update",
  value: 0.999,
  threshold: 0.95,
  severity: "low",
  message: "ok",
};

const claimFor = (holder: string, policyId = "p-1") => ({
  policyId,
  holder,
  coverageType: 0,
  triggered: true,
  payout: "1",
  reason: "r",
  processedAt: 1,
});

function stubReporter() {
  const errors: { error: RealtimeError; context: RealtimeErrorContext }[] = [];
  const crumbs: RealtimeBreadcrumb[] = [];
  const reporter: RealtimeReporter = {
    captureError: (error, context) => errors.push({ error, context }),
    addBreadcrumb: (crumb) => crumbs.push(crumb),
  };
  return { reporter, errors, crumbs };
}

function setup(opts: { maxAttempts?: number } = {}) {
  const sockets = fakeSocketFactory();
  const stub = stubReporter();
  const client = new RealtimeClient({
    createSocket: sockets.create,
    url: () => "ws://test/ws",
    reporter: stub.reporter,
    scopeDebounceMs: 200,
    maxAttempts: opts.maxAttempts ?? 3,
  });
  client.setEnabled(true);
  return { client, sockets, ...stub };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("versioning (#240)", () => {
  it("advertises supported versions and scope on subscribe", () => {
    const { client, sockets } = setup();
    client.subscribe("oracle_update", () => {});
    sockets.latest().serverOpen();
    expect(sockets.latest().subscriptions()).toEqual([
      {
        type: "subscribe",
        topic: "oracle_update",
        versions: [2, 1],
        scope: { network: "testnet" },
      },
    ]);
  });

  it("delivers a frame with no version as the legacy version", () => {
    const { client, sockets } = setup();
    const handler = vi.fn();
    client.subscribe("oracle_update", handler);
    sockets.latest().serverOpen();
    sockets.latest().serverSend({ topic: "oracle_update", payload: READING });
    expect(handler).toHaveBeenCalledWith(READING, expect.objectContaining({ version: 1 }));
  });

  it("degrades a topic to REST on a future-version frame and reports it once", () => {
    const { client, sockets, errors } = setup();
    const handler = vi.fn();
    client.subscribe("oracle_update", handler);
    const socket = sockets.latest();
    socket.serverOpen();

    socket.serverSend({ topic: "oracle_update", v: 99, payload: {} });
    socket.serverSend({ topic: "oracle_update", v: 99, payload: {} });
    // Even a valid frame is ignored once the topic is REST-only.
    socket.serverSend({ topic: "oracle_update", v: 1, payload: READING });

    expect(handler).not.toHaveBeenCalled();
    expect(client.health.get("oracle_update")).toBe("unavailable");
    expect(client.health.get()).toBe("healthy");
    expect(socket.sent).toContainEqual({ type: "unsubscribe", topic: "oracle_update" });
    expect(errors.map((e) => e.error.kind)).toEqual(["unsupported_version"]);
    expect(errors[0]!.context).toMatchObject({ topic: "oracle_update", fallback: "topic" });
  });

  it("degrades to REST when the server rejects every advertised version", () => {
    const { client, sockets, errors } = setup();
    client.subscribe("claim_settled", () => {});
    const socket = sockets.latest();
    socket.serverOpen();
    socket.serverSend({
      type: "error",
      code: "unsupported_version",
      topic: "claim_settled",
      supported: [3],
    });

    expect(client.health.get("claim_settled")).toBe("unavailable");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.retryable).toBe(false);

    // Not re-subscribed after a reconnect either.
    socket.serverDrop();
    vi.advanceTimersByTime(1_000);
    sockets.latest().serverOpen();
    expect(sockets.latest().subscriptions()).toEqual([]);
  });

  it("drops invalid payloads without breaking the stream", () => {
    const { client, sockets, errors } = setup();
    const handler = vi.fn();
    client.subscribe("oracle_update", handler);
    sockets.latest().serverOpen();
    sockets.latest().serverSend({ topic: "oracle_update", v: 1, payload: { nope: true } });
    sockets.latest().serverSend("not json");
    sockets.latest().serverSend({ topic: "oracle_update", v: 1, payload: READING });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(errors.map((e) => e.error.kind)).toEqual(["validation", "parse"]);
  });
});

describe("scope changes (#241)", () => {
  it("re-subscribes under the new scope on a fresh connection", () => {
    const { client, sockets } = setup();
    client.subscribe("holder_claim", () => {});
    client.setScope({ network: "testnet", account: ACCOUNT_A });
    vi.advanceTimersByTime(200);
    sockets.latest().serverOpen();
    expect(sockets.latest().subscriptions()[0]).toMatchObject({
      scope: { network: "testnet", account: ACCOUNT_A },
    });

    const first = sockets.latest();
    client.setScope({ network: "mainnet", account: ACCOUNT_B });
    vi.advanceTimersByTime(200);
    expect(first.closed).toBe(true);
    sockets.latest().serverOpen();
    expect(sockets.latest()).not.toBe(first);
    expect(sockets.latest().subscriptions()[0]).toMatchObject({
      scope: { network: "mainnet", account: ACCOUNT_B },
    });
  });

  it("does not subscribe account topics without an account", () => {
    const { client, sockets } = setup();
    client.subscribe("holder_claim", () => {});
    sockets.latest().serverOpen();
    expect(sockets.latest().subscriptions()).toEqual([]);
  });

  it("discards frames that arrive while a scope change is pending", () => {
    const { client, sockets } = setup();
    client.setScope({ network: "testnet", account: ACCOUNT_A });
    vi.advanceTimersByTime(200);
    const handler = vi.fn();
    client.subscribe("holder_claim", handler);
    const oldSocket = sockets.latest();
    oldSocket.serverOpen();

    client.setScope({ network: "testnet", account: ACCOUNT_B });
    // Old-identity frame lands right before teardown.
    oldSocket.serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_A) });
    expect(handler).not.toHaveBeenCalled();
  });

  it("discards frames from a superseded socket (epoch rejection)", () => {
    const { client, sockets } = setup();
    client.setScope({ network: "testnet", account: ACCOUNT_A });
    vi.advanceTimersByTime(200);
    const handler = vi.fn();
    client.subscribe("holder_claim", handler);
    const oldSocket = sockets.latest();
    oldSocket.serverOpen();
    const epochBefore = client.getEpoch();

    client.setScope({ network: "testnet", account: ACCOUNT_B });
    vi.advanceTimersByTime(200);
    expect(client.getEpoch()).toBe(epochBefore + 1);

    // A late frame still queued on the old socket.
    oldSocket.serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_A) });
    expect(handler).not.toHaveBeenCalled();

    sockets.latest().serverOpen();
    sockets.latest().serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_B) });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![1]).toMatchObject({
      epoch: epochBefore + 1,
      scope: { account: ACCOUNT_B },
    });
  });

  it("drops frames labelled with a different scope", () => {
    const { client, sockets } = setup();
    client.setScope({ network: "testnet", account: ACCOUNT_A });
    vi.advanceTimersByTime(200);
    const handler = vi.fn();
    client.subscribe("holder_claim", handler);
    sockets.latest().serverOpen();
    sockets.latest().serverSend({
      topic: "holder_claim",
      v: 1,
      payload: claimFor(ACCOUNT_B),
      scope: { network: "testnet", account: ACCOUNT_B },
    });
    sockets
      .latest()
      .serverSend({
        topic: "oracle_update",
        v: 1,
        payload: READING,
        scope: { network: "mainnet" },
      });
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears per-identity buffers so a late subscriber never sees the previous account's frame", () => {
    const { client, sockets } = setup();
    client.setScope({ network: "testnet", account: ACCOUNT_A });
    vi.advanceTimersByTime(200);
    client.subscribe("holder_claim", () => {});
    sockets.latest().serverOpen();
    sockets.latest().serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_A) });

    // Same scope: a late subscriber is replayed the last frame.
    const sameScope = vi.fn();
    client.subscribe("holder_claim", sameScope);
    expect(sameScope).toHaveBeenCalledTimes(1);

    client.setScope({ network: "testnet", account: ACCOUNT_B });
    vi.advanceTimersByTime(200);
    const late = vi.fn();
    client.subscribe("holder_claim", late);
    expect(late).not.toHaveBeenCalled();
  });

  it("debounces rapid switching into a single new connection", () => {
    const { client, sockets } = setup();
    client.subscribe("oracle_update", () => {});
    sockets.latest().serverOpen();
    const before = sockets.sockets.length;

    for (const network of ["mainnet", "futurenet", "testnet", "mainnet"]) {
      client.setScope({ network, account: null });
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(200);

    expect(sockets.sockets.length).toBe(before + 1);
    expect(sockets.sockets.filter((s) => !s.closed)).toHaveLength(1);
    expect(client.getScope().network).toBe("mainnet");
  });

  it("does nothing when toggled back to the current scope before the debounce fires", () => {
    const { client, sockets } = setup();
    client.subscribe("oracle_update", () => {});
    sockets.latest().serverOpen();
    const listener = vi.fn();
    client.onScopeChange(listener);

    client.setScope({ network: "mainnet", account: null });
    client.setScope({ network: "testnet", account: null });
    vi.advanceTimersByTime(500);

    expect(listener).not.toHaveBeenCalled();
    expect(sockets.sockets).toHaveLength(1);
  });

  it("notifies scope listeners with the new epoch", () => {
    const { client } = setup();
    const listener = vi.fn();
    client.onScopeChange(listener);
    client.setScope({ network: "testnet", account: ACCOUNT_A });
    vi.advanceTimersByTime(200);
    expect(listener).toHaveBeenCalledWith({ network: "testnet", account: ACCOUNT_A }, 1);
  });
});

describe("reporting (#238)", () => {
  it("emits lifecycle breadcrumbs for connect, open, drop, reconnect and scope change", () => {
    const { client, sockets, crumbs } = setup();
    client.subscribe("oracle_update", () => {});
    sockets.latest().serverOpen();
    sockets.latest().serverDrop();
    client.setScope({ network: "mainnet", account: null });
    vi.advanceTimersByTime(200);

    expect(crumbs.map((c) => c.event)).toEqual([
      "connecting",
      "open",
      "closed",
      "reconnect_scheduled",
      "scope_changed",
      "connecting",
    ]);
  });

  it("reports retries exhausted once, tagged with attempt and fallback", () => {
    const { client, sockets, errors, crumbs } = setup({ maxAttempts: 3 });
    client.subscribe("oracle_update", () => {});
    for (let i = 0; i < 6; i += 1) {
      sockets.latest().serverDrop();
      vi.advanceTimersByTime(30_000);
    }
    const exhausted = errors.filter((e) => e.error.kind === "retries_exhausted");
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]!.context).toMatchObject({
      transport: "websocket",
      attempt: 3,
      fallback: "all",
    });
    expect(crumbs.some((c) => c.event === "fallback_engaged")).toBe(true);
    expect(client.health.get()).toBe("unavailable");
  });

  it("moves health healthy → degraded → unavailable as reconnects fail", () => {
    const { client, sockets } = setup({ maxAttempts: 10 });
    client.subscribe("oracle_update", () => {});
    sockets.latest().serverOpen();
    expect(client.health.get()).toBe("healthy");
    sockets.latest().serverDrop();
    expect(client.health.get()).toBe("degraded");
    vi.advanceTimersByTime(1_000);
    sockets.latest().serverDrop();
    expect(client.health.get()).toBe("degraded");
    vi.advanceTimersByTime(2_000);
    sockets.latest().serverDrop();
    expect(client.health.get()).toBe("unavailable");
    vi.advanceTimersByTime(4_000);
    sockets.latest().serverOpen();
    expect(client.health.get()).toBe("healthy");
  });
});
