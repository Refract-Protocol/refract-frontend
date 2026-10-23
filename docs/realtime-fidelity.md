# Realtime runbook

## Event bus (`src/lib/realtime/bus.ts`)
The client decodes inbound `{ topic, payload }` messages and publishes them to a module-scoped typed bus. Consumers (hooks, stores, analytics) subscribe to the bus via `useRealtimeTopic`, never to the socket.

- Topic ids and payload types live in `topics.ts`.
- Snapshot topics replay their latest value to late subscribers (`getSnapshot`).
- Per-topic arrival order is preserved; re-entrant publishes are queued, not nested.
- A throwing handler is caught and logged (no payload) and never blocks other handlers.
- Max 100 handlers per topic; subscribing the same handler twice (StrictMode) is a no-op.

## View status matrix (`RealtimeView`)
| status | shows | indicator |
|---|---|---|
| `empty` | skeleton (sized to final content) | — |
| `live` | data | Live |
| `disconnected` | last data | Offline — showing last values |
| `reconnecting` | last data | Reconnecting… |
| `polling` | data | Updating periodically (realtime off) |

Skeletons render only for `empty`; a refresh of present data never re-shows them. Shimmer follows the global reduced-motion policy.

## Fidelity tiers (`src/lib/realtime/fidelity.ts`)
| tier | topics | coalescing | transport |
|---|---|---|---|
| `full` | oracle_update, protocol_status, network_health | none | websocket |
| `lite` | oracle_update, protocol_status | oracle_update ≥ 5 s | websocket |
| `minimal` | protocol_status (via polling) | — | polling |

Selection (`selectTier`): `saveData` / `2g` / battery < 15% (not charging) → `minimal`; `3g`, battery < 30%, ≤ 2 GB memory or ≤ 2 cores → `lite`; otherwise `full`. Missing signals assume unconstrained; SSR renders `full`.

Hysteresis: a downgrade applies after 3 s of a stable candidate, an upgrade after 30 s. Tier changes are sent to the client as subscribe/unsubscribe deltas (`syncTopics`), and the full set is re-sent on every reconnect. Topics registered with `critical: true` in `useRealtimeTopic` are never dropped by a downgrade.

Manual override: `fidelityController.setOverride("lite" | null)` (dev console / panel); the active tier is `fidelityController.getTier()`.
