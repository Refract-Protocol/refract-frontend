# Contributing

Thanks for contributing to Refract!

## Development

Install dependencies and start the dev server as usual. The app talks to
`refract-backend` over `NEXT_PUBLIC_API_URL` for REST; the realtime layer is
optional and off by default.

## Developing against the realtime mock server

The realtime layer is documented in [`docs/realtime/architecture.md`](docs/realtime/architecture.md)
and operated per [`docs/realtime/runbook.md`](docs/realtime/runbook.md). Because
the backend contract is documented but not yet implemented upstream in
`refract-backend`, develop against the local mock server:

1. Start the mock server locally (see the runbook).
2. Enable the flags you need in `public/flags.json` — `realtime.enabled: true`
   and the per-topic flag `realtime.topics.<topic>: true`. Both default to
   `false`.
3. Use `realtime.shadow: true` to observe realtime traffic without serving it
   while validating the pipeline.

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

## Testing realtime hooks

Use the in-memory fake transport (`@/lib/realtime/testing`) instead of hand-rolled WebSocket mocks. See [docs/realtime.md](docs/realtime.md).

## Realtime conventions

- Subscribe only through `realtimeClient` from `@/lib/realtime`, inside a `useEffect`/`useLayoutEffect`; never `new WebSocket`/`new EventSource` or deep imports like `@/lib/realtime/client` (enforced by ESLint). Escape hatch: `// eslint-disable-next-line <rule> -- <justification>`.
- Per-topic flags live in `public/flags.json` under `realtime.topics.<topic>` (`{ "enabled": boolean, "kill"?: boolean }`). Precedence: kill > in-memory override > `NEXT_PUBLIC_REALTIME_TOPICS_OVERRIDE` > flags.json > disabled. Missing or malformed entries fail closed.
- When you change the topic/message contract, update the schema module and
  `docs/realtime/architecture.md` together — the contract section is authoritative
  and must stay cross-checked against the schema.
