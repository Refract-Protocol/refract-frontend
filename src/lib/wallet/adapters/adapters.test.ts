import { describe, it, expect, vi, beforeEach } from "vitest";
import * as freighterApi from "@stellar/freighter-api";
import { freighterAdapter } from "./freighter";
import { xbullAdapter } from "./xbull";
import { getActiveAdapter, getAdapter, setActiveAdapter, WALLET_ADAPTERS } from "./index";

vi.mock("@stellar/freighter-api");
const f = vi.mocked(freighterApi);

beforeEach(() => {
  vi.resetAllMocks();
  delete (window as unknown as Record<string, unknown>).freighterApi;
  delete (window as unknown as Record<string, unknown>).xBullSDK;
});

describe("freighter adapter", () => {
  it("detects the extension", () => {
    expect(freighterAdapter.isAvailable()).toBe(false);
    (window as unknown as Record<string, unknown>).freighterApi = {};
    expect(freighterAdapter.isAvailable()).toBe(true);
  });

  it("connect resolves the address or throws", async () => {
    f.requestAccess.mockResolvedValueOnce({ address: "GA" } as never);
    await expect(freighterAdapter.connect()).resolves.toBe("GA");
    f.requestAccess.mockResolvedValueOnce({ error: { message: "nope" } } as never);
    await expect(freighterAdapter.connect()).rejects.toThrow("nope");
    f.requestAccess.mockResolvedValueOnce({} as never);
    await expect(freighterAdapter.connect()).rejects.toThrow("Connection was declined");
  });

  it("getAddress is silent and null unless connected+allowed", async () => {
    f.isConnected.mockResolvedValueOnce({ isConnected: false } as never);
    expect(await freighterAdapter.getAddress()).toBeNull();
    f.isConnected.mockResolvedValueOnce({ isConnected: true } as never);
    f.isAllowed.mockResolvedValueOnce({ isAllowed: false } as never);
    expect(await freighterAdapter.getAddress()).toBeNull();
    f.isConnected.mockResolvedValueOnce({ isConnected: true } as never);
    f.isAllowed.mockResolvedValueOnce({ isAllowed: true } as never);
    f.getAddress.mockResolvedValueOnce({ address: "GA" } as never);
    expect(await freighterAdapter.getAddress()).toBe("GA");
    f.isConnected.mockResolvedValueOnce({ isConnected: true } as never);
    f.isAllowed.mockResolvedValueOnce({ isAllowed: true } as never);
    f.getAddress.mockResolvedValueOnce({ error: { message: "x" } } as never);
    expect(await freighterAdapter.getAddress()).toBeNull();
  });

  it("getNetwork and signTransaction map the SDK responses", async () => {
    f.getNetwork.mockResolvedValue({ network: "TESTNET", networkPassphrase: "p", extra: 1 } as never);
    expect(await freighterAdapter.getNetwork()).toEqual({ network: "TESTNET", networkPassphrase: "p" });
    f.signTransaction.mockResolvedValueOnce({ signedTxXdr: "S" } as never);
    expect(await freighterAdapter.signTransaction("X", { networkPassphrase: "p", address: "GA" })).toBe("S");
    f.signTransaction.mockResolvedValueOnce({ error: { message: "declined" } } as never);
    await expect(freighterAdapter.signTransaction("X", { networkPassphrase: "p", address: "GA" })).rejects.toThrow(
      "declined"
    );
    f.signTransaction.mockResolvedValueOnce({} as never);
    await expect(freighterAdapter.signTransaction("X", { networkPassphrase: "p", address: "GA" })).rejects.toThrow(
      "Transaction signing was declined"
    );
  });
});

describe("xbull adapter", () => {
  const install = (overrides: Record<string, unknown> = {}) => {
    const sdk = {
      connect: vi.fn().mockResolvedValue(undefined),
      getPublicKey: vi.fn().mockResolvedValue("GX"),
      signXDR: vi.fn().mockResolvedValue("SIGNED"),
      ...overrides,
    };
    (window as unknown as Record<string, unknown>).xBullSDK = sdk;
    return sdk;
  };

  it("is unavailable and throws without the extension", async () => {
    expect(xbullAdapter.isAvailable()).toBe(false);
    expect(await xbullAdapter.getAddress()).toBeNull();
    await expect(xbullAdapter.connect()).rejects.toThrow("xBull extension not detected");
  });

  it("connects, reads address, signs for the given network, reports the configured network", async () => {
    const sdk = install();
    expect(xbullAdapter.isAvailable()).toBe(true);
    await expect(xbullAdapter.connect()).resolves.toBe("GX");
    expect(sdk.connect).toHaveBeenCalledWith({ canRequestPublicKey: true, canRequestSign: true });
    expect(await xbullAdapter.getAddress()).toBe("GX");
    expect(await xbullAdapter.signTransaction("X", { networkPassphrase: "p", address: "GX" })).toBe("SIGNED");
    expect(sdk.signXDR).toHaveBeenCalledWith("X", { publicKey: "GX", network: "p" });
    expect((await xbullAdapter.getNetwork()).networkPassphrase).toContain("Network");
  });

  it("handles declines and silent failures", async () => {
    install({ getPublicKey: vi.fn().mockRejectedValue(new Error("locked")), signXDR: vi.fn().mockResolvedValue("") });
    expect(await xbullAdapter.getAddress()).toBeNull();
    await expect(xbullAdapter.signTransaction("X", { networkPassphrase: "p", address: "GX" })).rejects.toThrow(
      "Transaction signing was declined"
    );
    install({ getPublicKey: vi.fn().mockResolvedValue("") });
    await expect(xbullAdapter.connect()).rejects.toThrow("Connection was declined");
  });
});

describe("adapter registry", () => {
  it("lists both adapters, falls back to Freighter, and tracks the active one", () => {
    expect(WALLET_ADAPTERS.map((a) => a.id)).toEqual(["freighter", "xbull"]);
    expect(getAdapter("xbull")).toBe(xbullAdapter);
    setActiveAdapter("xbull");
    expect(getActiveAdapter()).toBe(xbullAdapter);
    setActiveAdapter("freighter");
    expect(getActiveAdapter()).toBe(freighterAdapter);
  });
});
