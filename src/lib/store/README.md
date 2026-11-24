# Zustand store convention

Use a focused `<domain>Store.ts` for client state shared by unrelated component branches. Keep server data in the query/data layer and lifecycle-bound integrations (such as an active wallet connection) in their existing providers.

- Name hooks `use<Domain>Store` and actions as verbs.
- Select only the fields a component needs instead of subscribing to the full store.
- Use `persist` only for state that must survive reloads. Set a stable key and schema version, persist data fields with `partialize`, and never persist action functions.
- Persisted App Router stores must use an SSR-safe storage factory and `skipHydration: true`. A client provider owns the post-mount `store.persist.rehydrate()` call so server and initial client markup match.
- Reset store state and `localStorage` in each test. Cover actions, the serialized shape, explicit hydration, and importing/rendering without browser storage.

## `setState` semantics

`createStore` exposes `setState` as a **shallow merge**, not a replace. Only the keys you pass are updated; every other field keeps its current value.

```ts
const useCounterStore = createStore({ count: 0, label: 'idle' });

// Updates `count` only — `label` stays 'idle'.
useCounterStore.getState().setState({ count: 1 });
```

To clear a field, pass its reset value explicitly (e.g. `setState({ count: 0, label: 'idle' })`). This merge behaviour is what `notificationStore.ts` relies on when it updates a single notification field without rebuilding the whole state.

`walletPreferencesStore.ts` is the reference implementation. It persists the remembered adapter and Ledger UI preference while `WalletProvider` continues to own Freighter/WalletConnect async connection state.
