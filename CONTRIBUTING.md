# Contributing to Refract Frontend

Thanks for helping build the Refract web app! UI and DX contributions are very
welcome.

## Ground rules

- Be respectful — see the [Code of Conduct](./CODE_OF_CONDUCT.md).
- Discuss larger UI/UX changes in an issue first (a screenshot or sketch helps).
- Keep the build green: lint, typecheck, and build must pass.

## Getting set up

```bash
npm install
npm run dev      # http://localhost:3000
```

## Local gate (matches CI)

```bash
npm run lint
npm run typecheck
npm run api:check-drift
npm test
npm run build
```

## Regenerating API types

The response/request types in `src/lib/api/*.ts` are generated from
`openapi/refract-api.yaml` into `src/lib/api/generated/schema.d.ts` with
[`openapi-typescript`](https://openapi-ts.dev). `refract-backend` does not
publish an OpenAPI spec yet, so that YAML is a **hand-authored stopgap**
transcribed from `refract-backend/src/routes/*.ts`.

When a backend route shape changes:

1. Update the matching schema in `openapi/refract-api.yaml`.
2. Run `npm run api:generate` and commit both files.
3. If it's a new type, re-export it from the relevant `src/lib/api/*.ts` file
   (`export type Foo = ApiSchemas["Foo"];`).

CI runs `npm run api:check-drift`, which fails if the committed generated file
doesn't match what the spec produces. Never edit `schema.d.ts` by hand.

## Coding standards

- **TypeScript** throughout; type component props explicitly.
- Style with **Tailwind** utilities and the design tokens defined in
  `src/app/globals.css` (`--pm-*`). Avoid hard-coded hex colors — reuse tokens.
- Mark interactive client components with `"use client"`.
- Keep components accessible: semantic elements, labelled controls, visible focus.
- Prefer composition over deeply nested conditionals in JSX.

## What we'd love help with

- Wallet connection (Freighter / Stellar Wallets Kit) and transaction signing.
- Wiring pages to live `refract-backend` endpoints (replace placeholder data).
- A shared `lib/api` client and loading/error states.
- Responsive polish and reduced-motion support.

## Commit & PR conventions

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `style:`, `docs:`, `chore:`.
- Include before/after screenshots for visual changes in your PR.
