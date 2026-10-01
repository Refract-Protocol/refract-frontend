import {
  create,
  type StateCreator,
  type StoreApi,
  type UseBoundStore,
} from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

/**
 * SSR-safe Zustand store conventions.
 *
 * Why this module exists: the app runs on the Next.js App Router with
 * `reactStrictMode: true`. Every page is a client component that still renders
 * once on the server, and a naive `create()` at module scope would be shared
 * across server requests — leaking one user's state into another's render.
 *
 * Rule of thumb:
 * - Module-scope stores are only safe for state that is identical for every
 *   request (e.g. pure UI preferences, feature flags with no per-user data).
 * - Request-scope stores (anything derived from the session, wallet, cache or
 *   form state) must be created per request via `createAppStore` and provided
 *   through `StoreProvider` so each render tree gets an isolated instance.
 *
 * Devtools are wired through `zustand/middleware` and gated on
 * `process.env.NODE_ENV !== 'production'`, so the middleware is fully
 * tree-shaken from production bundles.
 */

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Creates a Zustand store that is safe on both the server and the client.
 *
 * The returned store is a plain `UseBoundStore` so it can be used directly
 * with `useStoreSelector` or passed through a React context for request
 * scoping. Devtools are only attached in development.
 *
 * @param initializer - The Zustand state creator for the store.
 * @param name - A stable name used as the devtools label.
 */
export function createAppStore<T>(
  initializer: StateCreator<T>,
  name: string,
): UseBoundStore<StoreApi<T>> {
  if (isDev) {
    return create<T>()(devtools(initializer, { name, enabled: true }));
  }

  return create<T>()(initializer);
}

/**
 * Typed selector helper with shallow-compare semantics.
 *
 * Components must select individual fields, never whole store objects:
 *
 * ```ts
 * // Good — only re-renders when `address` changes.
 * const address = useStoreSelector(walletStore, (s) => s.address);
 *
 * // Bad — subscribes to the whole store and re-renders on any change.
 * const wallet = useStoreSelector(walletStore, (s) => s);
 * ```
 *
 * When a component genuinely needs multiple fields, select them as a tuple or
 * object and rely on the shallow comparison to avoid redundant renders.
 */
export function useStoreSelector<T, U>(
  store: UseBoundStore<StoreApi<T>>,
  selector: (state: T) => U,
): U {
  return store(useShallow(selector));
}
