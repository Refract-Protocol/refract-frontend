import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWalletPreferenceStorage,
  useWalletPreferencesStore,
  WALLET_PREFERENCES_STORAGE_KEY,
} from "./walletPreferencesStore";

describe("walletPreferencesStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useWalletPreferencesStore.setState({ rememberedAdapter: null, hardwareWallet: false });
  });

  it("updates and persists only preference data", () => {
    const state = useWalletPreferencesStore.getState();
    state.rememberConnection("xbull");
    state.setHardwareWallet(true);
    expect(useWalletPreferencesStore.getState()).toMatchObject({
      rememberedAdapter: "xbull",
      hardwareWallet: true,
    });
    expect(JSON.parse(localStorage.getItem(WALLET_PREFERENCES_STORAGE_KEY) ?? "{}").state).toEqual({
      rememberedAdapter: "xbull",
      hardwareWallet: true,
    });
    useWalletPreferencesStore.getState().forgetConnection();
    expect(useWalletPreferencesStore.getState().rememberedAdapter).toBeNull();
  });

  it("hydrates only when explicitly requested", async () => {
    localStorage.setItem(
      WALLET_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: { rememberedAdapter: "freighter", hardwareWallet: true },
        version: 1,
      })
    );
    expect(useWalletPreferencesStore.getState().rememberedAdapter).toBeNull();
    await useWalletPreferencesStore.persist.rehydrate();
    expect(useWalletPreferencesStore.getState()).toMatchObject({
      rememberedAdapter: "freighter",
      hardwareWallet: true,
    });
  });

  it("uses inert storage during SSR", () => {
    const browserWindow = window;
    vi.stubGlobal("window", undefined);
    const storage = getWalletPreferenceStorage();
    expect(storage.getItem("x")).toBeNull();
    expect(storage.key(0)).toBeNull();
    expect(storage.length).toBe(0);
    expect(() => storage.setItem("x", "y")).not.toThrow();
    expect(() => storage.removeItem("x")).not.toThrow();
    expect(() => storage.clear()).not.toThrow();
    vi.stubGlobal("window", browserWindow);
  });
});
