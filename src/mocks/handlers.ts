import { http, HttpResponse, delay } from 'msw';

import type {
  PoolStats,
  UserPoolPosition,
  LockupStatus,
  ProvideRequest,
  WithdrawRequest,
} from '../lib/api/pool';
import type { Policy, PolicyListResponse } from '../lib/api/policies';
import type { OracleStatus } from '../lib/api/oracle';
import type { Claim, ClaimListResponse } from '../lib/api/claims';
import type { TxSubmitRequest, TxSubmitResponse } from '../lib/api/tx';

import {
  poolStatsFixture,
  userPoolPositionFixture,
  lockupStatusFixture,
} from '../lib/fixtures/pool';
import { policiesFixture } from '../lib/fixtures/policies';
import { oracleStatusFixture } from '../lib/fixtures/oracle';
import { claimsFixture } from '../lib/fixtures/claims';

/**
 * Mock Service Worker request handlers.
 *
 * These handlers reuse the typed data in `src/lib/fixtures/*` so that the
 * dev-mode MSW setup and the test suite share a single source of realistic
 * mock data. They are additive tooling only: the production
 * `ApiUnreachableError -> fixture` fallback in `src/lib/api/*` is untouched.
 *
 * Scenario overrides (e.g. a 500 response, a slow backend, a triggered claim)
 * can be applied per-test with `server.use(...)` in `src/mocks/server.ts`.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

const url = (path: string) => `${API_BASE}${path}`;

/** Simulated latency so dev-mode feels like a real backend. */
const LATENCY_MS = 150;

/**
 * In-memory mutable copies of the fixtures. Handlers that mutate state
 * (provide/withdraw/claim) operate on these so a dev session can observe
 * changes without a backend, while the original fixtures stay pristine for
 * tests that import them directly.
 */
let poolStats: PoolStats = { ...poolStatsFixture };
let userPosition: UserPoolPosition = { ...userPoolPositionFixture };
let lockupStatus: LockupStatus = { ...lockupStatusFixture };
let policies: Policy[] = [...policiesFixture];
let claims: Claim[] = [...claimsFixture];

/** Reset mutable mock state back to the seed fixtures (used between tests). */
export function resetMockState(): void {
  poolStats = { ...poolStatsFixture };
  userPosition = { ...userPoolPositionFixture };
  lockupStatus = { ...lockupStatusFixture };
  policies = [...policiesFixture];
  claims = [...claimsFixture];
}

export const handlers = [
  // --- Pool ---------------------------------------------------------------
  http.get(url('/pool/stats'), async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json(poolStats);
  }),

  http.get(url('/pool/user/:address'), async ({ params }) => {
    await delay(LATENCY_MS);
    return HttpResponse.json({ ...userPosition, address: String(params.address) });
  }),

  http.get(url('/pool/lockup/:address'), async ({ params }) => {
    await delay(LATENCY_MS);
    return HttpResponse.json({ ...lockupStatus, address: String(params.address) });
  }),

  http.post(url('/pool/provide'), async ({ request }) => {
    await delay(LATENCY_MS);
    const body = (await request.json()) as ProvideRequest;
    poolStats = {
      ...poolStats,
      totalLiquidity: poolStats.totalLiquidity + Number(body.amount ?? 0),
    };
    return HttpResponse.json({ ok: true, stats: poolStats });
  }),

  http.post(url('/pool/withdraw'), async ({ request }) => {
    await delay(LATENCY_MS);
    const body = (await request.json()) as WithdrawRequest;
    poolStats = {
      ...poolStats,
      totalLiquidity: Math.max(0, poolStats.totalLiquidity - Number(body.amount ?? 0)),
    };
    return HttpResponse.json({ ok: true, stats: poolStats });
  }),

  // --- Policies -----------------------------------------------------------
  http.get(url('/policies'), async () => {
    await delay(LATENCY_MS);
    const response: PolicyListResponse = { items: policies, total: policies.length };
    return HttpResponse.json(response);
  }),

  http.get(url('/policies/:id'), async ({ params }) => {
    await delay(LATENCY_MS);
    const policy = policies.find((p) => p.id === String(params.id));
    if (!policy) {
      return HttpResponse.json({ message: 'Policy not found' }, { status: 404 });
    }
    return HttpResponse.json(policy);
  }),

  // --- Oracle -------------------------------------------------------------
  http.get(url('/oracle/status'), async () => {
    await delay(LATENCY_MS);
    const status: OracleStatus = oracleStatusFixture;
    return HttpResponse.json(status);
  }),

  // --- Claims -------------------------------------------------------------
  http.get(url('/claims'), async () => {
    await delay(LATENCY_MS);
    const response: ClaimListResponse = { items: claims, total: claims.length };
    return HttpResponse.json(response);
  }),

  http.get(url('/claims/:id'), async ({ params }) => {
    await delay(LATENCY_MS);
    const claim = claims.find((c) => c.id === String(params.id));
    if (!claim) {
      return HttpResponse.json({ message: 'Claim not found' }, { status: 404 });
    }
    return HttpResponse.json(claim);
  }),

  http.post(url('/claims/:id/trigger'), async ({ params }) => {
    await delay(LATENCY_MS);
    const id = String(params.id);
    const existing = claims.find((c) => c.id === id);
    if (!existing) {
      return HttpResponse.json({ message: 'Claim not found' }, { status: 404 });
    }
    const updated: Claim = { ...existing, status: 'triggered' };
    claims = claims.map((c) => (c.id === id ? updated : c));
    return HttpResponse.json(updated);
  }),

  // --- Transactions -------------------------------------------------------
  http.post(url('/tx/submit'), async ({ request }) => {
    await delay(LATENCY_MS);
    const body = (await request.json()) as TxSubmitRequest;
    const response: TxSubmitResponse = {
      hash: `0xmock${Date.now().toString(16)}`,
      status: 'submitted',
      payload: body,
    };
    return HttpResponse.json(response);
  }),
];
