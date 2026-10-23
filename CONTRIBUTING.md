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

When you change the topic/message contract, update the schema module and
`docs/realtime/architecture.md` together — the contract section is authoritative
and must stay cross-checked against the schema.
