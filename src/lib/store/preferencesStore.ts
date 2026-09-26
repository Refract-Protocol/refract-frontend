import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * User display preferences.
 *
 * These preferences are persisted through the versioned storage envelope so
 * that a user can override OS-derived behaviour (motion) and choose how
 * numbers, dates and block-explorer links are presented.
 *
 * Defaults intentionally preserve the behaviour that existed before this
 * store was introduced:
 *  - `motion: 'system'` keeps deferring to the OS `prefers-reduced-motion`
 *    query (see `useReducedMotion`).
 *  - `locale: 'en-US'` matches the previously hardcoded locale used by
 *    `formatUsd` and the inline `toLocaleDateString` call sites.
 *  - `compactNumbers: false` keeps full-precision number formatting.
 *  - `explorerNetwork: 'auto'` derives the network from the connected wallet
 *    and falls back to testnet when no wallet is connected, matching the
 *    previously hardcoded testnet behaviour.
 */

export type MotionPreference = 'system' | 'reduced' | 'full';
export type ExplorerNetworkPreference = 'auto' | 'testnet' | 'public';

export interface PreferencesState {
  motion: MotionPreference;
  locale: string;
  compactNumbers: boolean;
  explorerNetwork: ExplorerNetworkPreference;
  setMotion: (motion: MotionPreference) => void;
  setLocale: (locale: string) => void;
  setCompactNumbers: (compactNumbers: boolean) => void;
  setExplorerNetwork: (explorerNetwork: ExplorerNetworkPreference) => void;
  reset: () => void;
}

const STORAGE_KEY = 'handsoff:preferences';
const STORAGE_VERSION = 1;

export const DEFAULT_PREFERENCES = {
  motion: 'system' as MotionPreference,
  locale: 'en-US',
  compactNumbers: false,
  explorerNetwork: 'auto' as ExplorerNetworkPreference,
};

/**
 * Versioned storage envelope. Wrapping the persisted payload in a versioned
 * object lets us migrate preferences in the future without discarding user
 * choices, and keeps the persisted shape stable across releases.
 */
interface PersistedEnvelope {
  version: number;
  state: Pick<
    PreferencesState,
    'motion' | 'locale' | 'compactNumbers' | 'explorerNetwork'
  >;
}

const storage = createJSONStorage<PersistedEnvelope>(() => {
  if (typeof window === 'undefined') {
    // SSR-safe no-op storage; the store still works in-memory on the server.
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
  return window.localStorage;
});

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      setMotion: (motion) => set({ motion }),
      setLocale: (locale) => set({ locale }),
      setCompactNumbers: (compactNumbers) => set({ compactNumbers }),
      setExplorerNetwork: (explorerNetwork) => set({ explorerNetwork }),
      reset: () => set({ ...DEFAULT_PREFERENCES }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage,
      // Persist only the user-facing values, never the action functions.
      partialize: (state) => ({
        version: STORAGE_VERSION,
        state: {
          motion: state.motion,
          locale: state.locale,
          compactNumbers: state.compactNumbers,
          explorerNetwork: state.explorerNetwork,
        },
      }),
      // Rehydrate from the versioned envelope, falling back to defaults for
      // any missing or unknown fields so old payloads never break the app.
      merge: (persisted, current) => {
        const envelope = persisted as PersistedEnvelope | undefined;
        const stored = envelope?.state;
        if (!stored) {
          return current;
        }
        return {
          ...current,
          motion: stored.motion ?? current.motion,
          locale: stored.locale ?? current.locale,
          compactNumbers: stored.compactNumbers ?? current.compactNumbers,
          explorerNetwork: stored.explorerNetwork ?? current.explorerNetwork,
        };
      },
    },
  ),
);

/**
 * Non-reactive read of the current preferences. Useful outside React (e.g.
 * `stellarExpertTxUrl`) where subscribing to the store is not appropriate.
 */
export function getPreferences(): Pick<
  PreferencesState,
  'motion' | 'locale' | 'compactNumbers' | 'explorerNetwork'
> {
  const { motion, locale, compactNumbers, explorerNetwork } =
    usePreferencesStore.getState();
  return { motion, locale, compactNumbers, explorerNetwork };
}
