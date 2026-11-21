# Store

Thin wrapper around Zustand. See [`createStore.ts`](./createStore.ts) for the full API and [`index.ts`](./index.ts) for the public exports.

## Exports

- `createAppStore` — creates the app store instance.
- `useStoreSelector` — subscribes a component to a single slice of state.

## Usage

Components must select individual fields rather than the whole store, so they only re-render when their own slice changes.

```ts
import { useStoreSelector } from '@/lib/store';

function Counter() {
  const count = useStoreSelector((state) => state.count);
  return <span>{count}</span>;
}
```

Creating a store:

```ts
import { createAppStore } from '@/lib/store';

const store = createAppStore();
```

For actions, middleware, and the full state shape, read the source in [`createStore.ts`](./createStore.ts).
