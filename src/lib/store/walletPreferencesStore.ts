import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WalletAdapterId } from "@/lib/wallet/adapters/types";

export const WALLET_PREFERENCES_STORAGE_KEY = "refract:wallet-preferences";

interface WalletPreferencesState {
  rememberedAdapter: WalletAdapterId | null;
  hardwareWallet: boolean;
  rememberConnection: (adapter: WalletAdapterId) => void;
  forgetConnection: () => void;
  setHardwareWallet: (value: boolean) => void;
}

const memoryStorage: Storage = {
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

export function getWalletPreferenceStorage(): Storage {
  return typeof window === "undefined" ? memoryStorage : window.localStorage;
}

/** Persisted UI preferences for the wallet; live connection state stays in WalletProvider. */
export const useWalletPreferencesStore = create<WalletPreferencesState>()(
  persist(
    (set) => ({
      rememberedAdapter: null,
      hardwareWallet: false,
      rememberConnection: (rememberedAdapter) => set({ rememberedAdapter }),
      forgetConnection: () => set({ rememberedAdapter: null }),
      setHardwareWallet: (hardwareWallet) => set({ hardwareWallet }),
    }),
    {
      name: WALLET_PREFERENCES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(getWalletPreferenceStorage),
      partialize: ({ rememberedAdapter, hardwareWallet }) => ({
        rememberedAdapter,
        hardwareWallet,
      }),
      // The server and first client render share defaults; WalletProvider opts
      // into hydration after mount, avoiding App Router markup mismatches.
      skipHydration: true,
    }
  )
);
