import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "./client";
import { RealtimeScopeSync } from "./RealtimeScopeSync";
import { deriveScope, networkIdFromPassphrase } from "./scope";
import { fakeSocketFactory } from "./testing/fakeSocket";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { NETWORKS } from "@/lib/network";

const ACCOUNT_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ACCOUNT_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const wallet = {
  status: "connected",
  address: ACCOUNT_A as string | null,
  networkPassphrase: NETWORKS.testnet.networkPassphrase as string | null,
};

vi.mock("@/lib/wallet/WalletProvider", () => ({ useWallet: () => wallet }));
vi.mock("@/lib/flags/useFeatureFlag", () => ({
  useFeatureFlag: (key: string) => key === "realtime",
}));

const claimFor = (holder: string) => ({
  policyId: "p-1",
  holder,
  coverageType: 0,
  triggered: true,
  payout: "1",
  reason: "r",
  processedAt: 1,
});

function makeClient() {
  const sockets = fakeSocketFactory();
  const client = new RealtimeClient({ createSocket: sockets.create, scopeDebounceMs: 100 });
  return { client, sockets };
}

beforeEach(() => {
  vi.useFakeTimers();
  wallet.status = "connected";
  wallet.address = ACCOUNT_A;
  wallet.networkPassphrase = NETWORKS.testnet.networkPassphrase;
});
afterEach(() => vi.useRealTimers());

describe("deriveScope", () => {
  it("maps the wallet's passphrase to a network id and drops the account when disconnected", () => {
    expect(networkIdFromPassphrase(NETWORKS.mainnet.networkPassphrase)).toBe("mainnet");
    expect(networkIdFromPassphrase("unknown")).toBe("testnet");
    expect(
      deriveScope({
        status: "connected",
        address: ACCOUNT_A,
        networkPassphrase: NETWORKS.futurenet.networkPassphrase,
      })
    ).toEqual({
      network: "futurenet",
      account: ACCOUNT_A,
    });
    expect(deriveScope({ status: "idle", address: null, networkPassphrase: null })).toEqual({
      network: "testnet",
      account: null,
    });
  });
});

describe("RealtimeScopeSync", () => {
  function renderSync(client: RealtimeClient, queryClient: QueryClient) {
    return render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RealtimeScopeSync, { client })
      )
    );
  }

  it("enables the client and binds it to the wallet's scope", () => {
    const { client } = makeClient();
    renderSync(client, new QueryClient());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(client.isEnabled()).toBe(true);
    expect(client.getScope()).toEqual({ network: "testnet", account: ACCOUNT_A });
  });

  it("resets wallet-scoped / realtime-merged queries on an account switch, leaving others alone", async () => {
    const { client } = makeClient();
    const queryClient = new QueryClient();
    const view = renderSync(client, queryClient);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    queryClient.setQueryData(["holderClaims", ACCOUNT_A], [claimFor(ACCOUNT_A)]);
    queryClient.setQueryData(["oracleStatus"], { data: [], isFixture: false, error: null });
    queryClient.setQueryData(["poolStats"], { tvl: 1 });

    wallet.address = ACCOUNT_B;
    view.rerender(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RealtimeScopeSync, { client })
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(client.getScope().account).toBe(ACCOUNT_B);
    expect(queryClient.getQueryData(["holderClaims", ACCOUNT_A])).toBeUndefined();
    expect(queryClient.getQueryData(["oracleStatus"])).toBeUndefined();
    expect(queryClient.getQueryData(["poolStats"])).toEqual({ tvl: 1 });
  });

  it("resets scoped queries on a network switch", async () => {
    const { client } = makeClient();
    const queryClient = new QueryClient();
    const view = renderSync(client, queryClient);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    queryClient.setQueryData(["recentClaims"], {
      data: [claimFor(ACCOUNT_A)],
      isFixture: false,
      error: null,
    });

    wallet.networkPassphrase = NETWORKS.mainnet.networkPassphrase;
    view.rerender(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RealtimeScopeSync, { client })
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(client.getScope()).toEqual({ network: "mainnet", account: ACCOUNT_A });
    expect(queryClient.getQueryData(["recentClaims"])).toBeUndefined();
  });
});

describe("useRealtimeTopic — no cross-identity leakage", () => {
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: new QueryClient() }, children);
  }

  it("only hands a consumer frames for its own account in the current epoch", () => {
    const { client, sockets } = makeClient();
    client.setEnabled(true);
    client.setScope({ network: "testnet", account: ACCOUNT_A });
    vi.advanceTimersByTime(100);

    const received: string[] = [];
    const { rerender } = renderHook(
      ({ account }: { account: string }) =>
        useRealtimeTopic("holder_claim", (claim) => received.push(claim.holder), {
          account,
          client,
        }),
      { initialProps: { account: ACCOUNT_A }, wrapper }
    );

    const socketA = sockets.latest();
    socketA.serverOpen();
    socketA.serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_A) });
    expect(received).toEqual([ACCOUNT_A]);

    // Switch identity: the UI re-renders for B before the client's debounce fires.
    client.setScope({ network: "testnet", account: ACCOUNT_B });
    rerender({ account: ACCOUNT_B });
    socketA.serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_A) });
    vi.advanceTimersByTime(100);
    socketA.serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_A) });
    expect(received).toEqual([ACCOUNT_A]);

    const socketB = sockets.latest();
    expect(socketB).not.toBe(socketA);
    socketB.serverOpen();
    socketB.serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_B) });
    expect(received).toEqual([ACCOUNT_A, ACCOUNT_B]);
  });

  it("ignores frames for a scope the consumer isn't bound to", () => {
    const { client, sockets } = makeClient();
    client.setEnabled(true);
    client.setScope({ network: "testnet", account: ACCOUNT_A });
    vi.advanceTimersByTime(100);

    const handler = vi.fn();
    // A consumer still bound to B (e.g. mid-render) must not receive A's data.
    renderHook(() => useRealtimeTopic("holder_claim", handler, { account: ACCOUNT_B, client }), {
      wrapper,
    });
    sockets.latest().serverOpen();
    sockets.latest().serverSend({ topic: "holder_claim", v: 1, payload: claimFor(ACCOUNT_A) });
    expect(handler).not.toHaveBeenCalled();
  });
});
