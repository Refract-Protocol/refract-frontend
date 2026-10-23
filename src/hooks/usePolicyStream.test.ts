// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolicyStream } from "./usePolicyStream";
import { PolicyProgress } from "@/components/cover/PolicyProgress";
import { RealtimeClient } from "@/lib/realtime/client";
import { FakeWebSocket } from "@/lib/realtime/dev/fakeSocket";
import { PENDING_WAIT_MS, usePendingPolicyStore } from "@/lib/realtime/pendingPolicies";
import { parsePolicyEvent } from "@/lib/realtime/policyEvents";
import { policyTopic } from "@/lib/realtime/topics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOLDER = "GHOLDERADDRESS";

let container: HTMLDivElement;
let root: Root;
let client: RealtimeClient;
const load = () => Promise.resolve({ getRealtimeClient: () => client, parsePolicyEvent });

function Harness({ address }: { address: string }) {
  const entries = usePolicyStream(address, { load });
  return createElement(
    "div",
    null,
    entries.map((entry) => createElement(PolicyProgress, { key: entry.key, entry }))
  );
}

async function render(address = HOLDER) {
  await act(async () => {
    root.render(createElement(Harness, { address }));
  });
}

const statuses = () =>
  [...container.querySelectorAll("[data-testid=policy-progress]")].map((el) =>
    el.getAttribute("data-status")
  );

async function push(payload: Record<string, unknown>) {
  await act(async () => {
    FakeWebSocket.latest().push(policyTopic(HOLDER), {
      holder: HOLDER,
      ts: Date.now(),
      ...payload,
    });
  });
}

function submit(txHash = "tx1") {
  act(() => {
    usePendingPolicyStore
      .getState()
      .addOptimistic({ txHash, holder: HOLDER, policyId: "p1", coverageTypeName: "Depeg" });
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
  localStorage.clear();
  usePendingPolicyStore.setState({ entries: [] });
  client = new RealtimeClient({ url: "ws://test", WebSocketImpl: FakeWebSocket as never });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  client.disconnect();
  container.remove();
  vi.useRealTimers();
});

describe("usePolicyStream + cover progress (integration)", () => {
  it("does not subscribe while nothing is pending", async () => {
    await render();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("renders submitted → accepted → active as events arrive", async () => {
    await render();
    submit();
    await act(async () => {});
    FakeWebSocket.latest().open();
    expect(statuses()).toEqual(["submitted"]);

    await push({ type: "accepted", txHash: "tx1" });
    expect(statuses()).toEqual(["accepted"]);

    await push({ type: "issued", txHash: "tx1", policyId: "p1" });
    expect(statuses()).toEqual(["active"]);
    expect(container.textContent).toContain("Active and confirmed on-chain");
  });

  it("rolls back to failed on a failure event", async () => {
    await render();
    submit();
    await act(async () => {});
    FakeWebSocket.latest().open();
    await push({ type: "failed", txHash: "tx1", reason: "transaction reverted" });
    expect(statuses()).toEqual(["failed"]);
    expect(container.textContent).toContain("transaction reverted");
  });

  it("ignores malformed payloads and events for another wallet", async () => {
    await render();
    submit();
    await act(async () => {});
    FakeWebSocket.latest().open();
    await push({ type: "issued" }); // missing ids
    await push({ type: "issued", txHash: "tx1", policyId: "p1", holder: "GSOMEONEELSE" });
    expect(statuses()).toEqual(["submitted"]);
  });

  it("resumes a pending purchase after navigating away and back, without duplicating it", async () => {
    submit();
    await render();
    await act(async () => {});
    act(() => root.unmount());

    // Back on /cover: a fresh mount picks up the persisted pending entry and subscribes.
    root = createRoot(container);
    await render();
    await act(async () => {});
    FakeWebSocket.latest().open();
    await push({ type: "issued", txHash: "tx1", policyId: "p1" });
    expect(statuses()).toEqual(["active"]);
  });

  it("settles from the REST result when no event arrives in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await render();
    submit();
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(PENDING_WAIT_MS + 1);
    });
    expect(statuses()).toEqual(["active"]);
    expect(container.textContent).toContain("live confirmation didn't arrive in time");
  });
});
