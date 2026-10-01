import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { WalletProvider, useWallet } from "./WalletProvider";
import type { WalletAdapter } from "./adapters";

const fake = (id: "freighter" | "xbull", address: string, available = true) => ({
  id,
  name: id,
  installUrl: "",
  isAvailable: vi.fn(() => available),
  connect: vi.fn(async () => address),
  getAddress: vi.fn(async (): Promise<string | null> => address),
  getNetwork: vi.fn(async () => ({ network: "TESTNET", networkPassphrase: "pass" })),
  signTransaction: vi.fn(async () => "signed"),
});

let freighter: ReturnType<typeof fake>;
let xbull: ReturnType<typeof fake>;

vi.mock("./adapters", async () => {
  const actual = await vi.importActual<typeof import("./adapters")>("./adapters");
  return {
    ...actual,
    get WALLET_ADAPTERS() {
      return [freighter, xbull] as WalletAdapter[];
    },
    getAdapter: (id: string) => (id === "xbull" ? xbull : freighter),
    setActiveAdapter: vi.fn(),
  };
});

const wrapper = ({ children }: { children: ReactNode }) => createElement(WalletProvider, null, children);

beforeEach(() => {
  freighter = fake("freighter", "GFREIGHTER");
  xbull = fake("xbull", "GXBULL");
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("WalletProvider (adapter-driven)", () => {
  it("connects through the chosen adapter with an adapter-agnostic state shape", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let addr: string | null = null;
    await act(async () => {
      addr = await result.current.connect("xbull");
    });
    expect(addr).toBe("GXBULL");
    expect(result.current).toMatchObject({
      status: "connected",
      address: "GXBULL",
      network: "TESTNET",
      networkPassphrase: "pass",
      installed: true,
      error: null,
      adapterId: "xbull",
    });
    expect(localStorage.getItem("refract:wallet-adapter")).toBe("xbull");
  });

  it("defaults connect() to the first available adapter (no breaking change for existing callers)", async () => {
    freighter.isAvailable.mockReturnValue(false);
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.adapterId).toBe("xbull");
  });

  it("records an error and returns null when the adapter rejects", async () => {
    freighter.connect.mockRejectedValue(new Error("Connection was declined"));
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let addr: string | null = "x";
    await act(async () => {
      addr = await result.current.connect("freighter");
    });
    expect(addr).toBeNull();
    expect(result.current).toMatchObject({ status: "error", error: "Connection was declined" });
  });

  it("reports a missing wallet without calling connect", async () => {
    xbull.isAvailable.mockReturnValue(false);
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.connect("xbull");
    });
    expect(xbull.connect).not.toHaveBeenCalled();
    expect(result.current.error).toBe("xbull extension not detected");
  });

  it("silently rehydrates per-adapter, and legacy sessions default to Freighter", async () => {
    localStorage.setItem("refract:wallet-connected", "1");
    localStorage.setItem("refract:wallet-adapter", "xbull");
    const first = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(first.result.current.status).toBe("connected"));
    expect(first.result.current.address).toBe("GXBULL");
    expect(xbull.connect).not.toHaveBeenCalled();
    first.unmount();

    localStorage.removeItem("refract:wallet-adapter");
    const legacy = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(legacy.result.current.status).toBe("connected"));
    expect(legacy.result.current.address).toBe("GFREIGHTER");
  });

  it("does not rehydrate when the wallet no longer authorizes the dApp", async () => {
    localStorage.setItem("refract:wallet-connected", "1");
    freighter.getAddress.mockResolvedValue(null);
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.status).toBe("idle");
  });

  it("disconnect clears the session", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.connect("freighter");
    });
    act(() => result.current.disconnect());
    expect(result.current).toMatchObject({ status: "idle", address: null, adapterId: null });
    expect(localStorage.getItem("refract:wallet-connected")).toBeNull();
  });

  it("blocks submission once idle until the user re-confirms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.connect("freighter");
    });
    expect(await result.current.ensureActive()).toBe(true);

    act(() => vi.advanceTimersByTime(15 * 60_000));
    await waitFor(() => expect(result.current.idle).toBe(true));

    let outcome: boolean | undefined;
    act(() => {
      void result.current.ensureActive().then((ok) => (outcome = ok));
    });
    const confirm = await waitFor(() => {
      const btn = document.body.querySelector<HTMLButtonElement>("button.pm-btn-primary");
      if (!btn) throw new Error("prompt not shown");
      return btn;
    });
    expect(outcome).toBeUndefined();
    await act(async () => confirm.click());
    await waitFor(() => expect(outcome).toBe(true));
    expect(result.current.idle).toBe(false);
  });
});
