# Contributing

## Styling

- Use Tailwind utility classes.
- Prefer composition over custom CSS.

## TypeScript

- Keep types explicit at module boundaries.
- Avoid `any`; prefer `unknown` and narrow.

## State

All shared state uses the SSR-safe store conventions in `src/lib/store`.

- Create stores with `createAppStore<T>(initializer, name)` from
  `@/lib/store`. It wires `zustand/middleware` devtools in development only,
  so the middleware is tree-shaken from production builds.
- Module-scope stores are only allowed for state that is identical for every
  request. Anything derived from the session, wallet, cache or form state must
  be request-scoped and provided through `StoreProvider`.
- Components must select individual fields, never whole store objects:

```ts
import { useStoreSelector } from '@/lib/store';

// Good — only re-renders when `address` changes.
const address = useStoreSelector(walletStore, (s) => s.address);

// Bad — subscribes to the whole store and re-renders on any change.
const wallet = useStoreSelector(walletStore, (s) => s);
```

- Never read `localStorage` during render. Apply persisted state after mount
  to avoid hydration mismatches.
- Review checklist: reject any PR that subscribes to a whole store object.

## Realtime conventions

- Subscribe only through `realtimeClient` from `@/lib/realtime`, inside a `useEffect`/`useLayoutEffect`; never `new WebSocket`/`new EventSource` or deep imports like `@/lib/realtime/client` (enforced by ESLint). Escape hatch: `// eslint-disable-next-line <rule> -- <justification>`.
- Per-topic flags live in `public/flags.json` under `realtime.topics.<topic>` (`{ "enabled": boolean, "kill"?: boolean }`). Precedence: kill > in-memory override > `NEXT_PUBLIC_REALTIME_TOPICS_OVERRIDE` > flags.json > disabled. Missing or malformed entries fail closed.
