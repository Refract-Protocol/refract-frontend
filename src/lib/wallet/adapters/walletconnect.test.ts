import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { topic: string }) => void>();
  return {
    handlers,
    approval: vi.fn<() => Promise<unknown>>(),
    client: {
      on: vi.fn((event: string, handler: (event: { topic: string }) => void) =>
        handlers.set(event, handler)
      ),
      connect: vi.fn(),
      request: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      session: { get: vi.fn(), getAll: vi.fn((): unknown[] => []) },
      core: { pairing: { getPairings: vi.fn((): unknown[] => []), disconnect: vi.fn() } },
    },
  };
});

vi.mock("@walletconnect/sign-client", () => ({
  default: { init: vi.fn(async () => mocks.client) },
}));

import {
  cancelWalletConnect,
  getWalletConnectState,
  resetWalletConnectForTests,
  walletConnectAdapter,
} from "./walletconnect";

const session = {
  topic: "session-topic",
  namespaces: { stellar: { accounts: ["stellar:testnet:GTESTACCOUNT"] } },
};

describe("WalletConnect adapter lifecycle", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "project-id");
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.client.connect.mockResolvedValue({ uri: "wc:test", approval: mocks.approval });
    mocks.client.session.getAll.mockReturnValue([]);
    mocks.client.core.pairing.getPairings.mockReturnValue([]);
    resetWalletConnectForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("moves from pending to connected and signs XDR", async () => {
    let approve!: (value: unknown) => void;
    mocks.approval.mockReturnValue(
      new Promise((resolve) => {
        approve = resolve;
      })
    );
    const connecting = walletConnectAdapter.connect();
    await vi.waitFor(() =>
      expect(getWalletConnectState()).toMatchObject({ status: "pending", uri: "wc:test" })
    );
    approve(session);
    await expect(connecting).resolves.toBe("GTESTACCOUNT");
    expect(getWalletConnectState().status).toBe("connected");

    mocks.client.request.mockResolvedValue({ signedXDR: "signed" });
    await expect(
      walletConnectAdapter.signTransaction("xdr", {
        address: "GTESTACCOUNT",
        networkPassphrase: "test",
      })
    ).resolves.toBe("signed");
    expect(mocks.client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "session-topic",
        request: { method: "stellar_signXDR", params: { xdr: "xdr" } },
      })
    );
  });

  it("reports rejection distinctly", async () => {
    mocks.approval.mockRejectedValue(new Error("user rejected"));
    await expect(walletConnectAdapter.connect()).rejects.toThrow("was rejected");
    expect(getWalletConnectState()).toMatchObject({ status: "rejected", uri: null });
  });

  it("times out and clears pairings", async () => {
    vi.useFakeTimers();
    mocks.approval.mockReturnValue(new Promise(() => undefined));
    const connecting = walletConnectAdapter.connect();
    const result = expect(connecting).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await result;
    expect(getWalletConnectState().status).toBe("timed-out");
  });

  it("reports remote deletion and supports explicit disconnect", async () => {
    mocks.approval.mockResolvedValue(session);
    await walletConnectAdapter.connect();
    const disconnected = vi.fn();
    const unsubscribe = walletConnectAdapter.subscribeDisconnect?.(disconnected);
    mocks.handlers.get("session_delete")?.({ topic: "session-topic" });
    expect(getWalletConnectState().status).toBe("disconnected");
    expect(disconnected).toHaveBeenCalledOnce();
    unsubscribe?.();

    mocks.approval.mockResolvedValue(session);
    await walletConnectAdapter.connect();
    await walletConnectAdapter.disconnect?.();
    expect(mocks.client.disconnect).toHaveBeenCalled();
    expect(getWalletConnectState().status).toBe("disconnected");
  });

  it("handles configuration, malformed proposals, and session lookup failures", async () => {
    vi.unstubAllEnvs();
    await expect(walletConnectAdapter.connect()).rejects.toThrow("not configured");

    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "project-id");
    resetWalletConnectForTests();
    mocks.client.connect.mockResolvedValueOnce({ uri: null, approval: mocks.approval });
    await expect(walletConnectAdapter.connect()).rejects.toThrow("pairing URI");

    resetWalletConnectForTests();
    mocks.client.connect.mockResolvedValue({ uri: "wc:test", approval: mocks.approval });
    mocks.approval.mockResolvedValue({ topic: "bad", namespaces: { stellar: { accounts: [] } } });
    await expect(walletConnectAdapter.connect()).rejects.toThrow("was rejected");
    expect(await walletConnectAdapter.getAddress()).toBeNull();
  });

  it("resumes stored sessions, emits expiry, and covers cleanup states", async () => {
    expect(walletConnectAdapter.isAvailable()).toBe(true);
    await cancelWalletConnect();
    mocks.client.session.getAll.mockReturnValue([session]);
    expect(await walletConnectAdapter.getAddress()).toBe("GTESTACCOUNT");
    expect(await walletConnectAdapter.getNetwork()).toMatchObject({ network: "TESTNET" });

    const disconnected = vi.fn();
    walletConnectAdapter.subscribeDisconnect?.(disconnected);
    mocks.handlers.get("session_expire")?.({ topic: "another-topic" });
    expect(disconnected).not.toHaveBeenCalled();
    mocks.handlers.get("session_expire")?.({ topic: "session-topic" });
    expect(disconnected).toHaveBeenCalledOnce();

    await walletConnectAdapter.disconnect?.();
    resetWalletConnectForTests();
    await walletConnectAdapter.disconnect?.();
  });

  it("rejects signing without a session or signed response", async () => {
    await expect(
      walletConnectAdapter.signTransaction("xdr", { address: "G", networkPassphrase: "test" })
    ).rejects.toThrow("session is not active");
    mocks.client.session.getAll.mockReturnValue([session]);
    await walletConnectAdapter.getAddress();
    mocks.client.request.mockResolvedValue({});
    await expect(
      walletConnectAdapter.signTransaction("xdr", { address: "G", networkPassphrase: "test" })
    ).rejects.toThrow("signing was declined");
    await cancelWalletConnect();
  });
});
