import { http, HttpResponse, delay } from "msw";

import { API_BASE_URL } from "../lib/api/client";
import type { PoolStats } from "../lib/api/pool";
import type { SubmitTxResult } from "../lib/api/tx";
import {
  FIXTURE_POOL_STATS,
  FIXTURE_POOL_ALLOCATION,
  fixtureUserPoolPosition,
} from "../lib/fixtures/poolStats";
import { fixtureHolderPolicies } from "../lib/fixtures/policies";
import { FIXTURE_ORACLE_READINGS } from "../lib/fixtures/oracle";
import { FIXTURE_RECENT_CLAIMS } from "../lib/fixtures/recentClaims";
import { fixtureClaimsForHolder } from "../lib/fixtures/claims";
import { FIXTURE_CLAIM_STATS } from "../lib/fixtures/claimStats";
import { FIXTURE_COVERAGE_TYPES } from "../lib/fixtures/coverageTypes";

/**
 * Mock Service Worker request handlers.
 *
 * These handlers reuse the typed data in `src/lib/fixtures/*` so that the
 * dev-mode MSW setup and the test suite share a single source of realistic
 * mock data. They are additive tooling only: the production
 * `ApiUnreachableError -> fixture` fallback in `src/lib/api/*` is untouched.
 *
 * Scenario overrides (e.g. a 500 response, a slow backend) can be applied
 * per-test with `server.use(...)` in `src/mocks/server.ts`.
 */

const url = (path: string) => `${API_BASE_URL}${path}`;

/** Simulated latency so dev-mode feels like a real backend. */
const LATENCY_MS = 150;

/**
 * In-memory mutable copy of the pool stats. Provide/withdraw mutate it so a
 * dev session can observe changes without a backend, while the original
 * fixture stays pristine for tests that import it directly.
 */
let poolStats: PoolStats = { ...FIXTURE_POOL_STATS };

/** Reset mutable mock state back to the seed fixtures (used between tests). */
export function resetMockState(): void {
  poolStats = { ...FIXTURE_POOL_STATS };
}

const addBaseUnits = (a: string, b: string) => (BigInt(a) + BigInt(b)).toString();
const subBaseUnits = (a: string, b: string) => {
  const result = BigInt(a) - BigInt(b);
  return (result < 0n ? 0n : result).toString();
};

const DEMO_XDR = "MSW_MOCK — no real transaction was built";

export const handlers = [
  // --- Pool ---------------------------------------------------------------
  http.get(url("/pool/stats"), async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json(poolStats);
  }),

  http.get(url("/pool/allocation"), async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json(FIXTURE_POOL_ALLOCATION);
  }),

  http.get(url("/pool/user/:address"), async ({ params }) => {
    await delay(LATENCY_MS);
    return HttpResponse.json(fixtureUserPoolPosition(String(params.address)));
  }),

  http.get(url("/pool/lockup/:address"), async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json({ lockupExpiresAt: null });
  }),

  http.post(url("/pool/provide"), async ({ request }) => {
    await delay(LATENCY_MS);
    const body = (await request.json()) as { provider: string; amount: string };
    poolStats = {
      ...poolStats,
      totalUsdc: addBaseUnits(poolStats.totalUsdc, body.amount),
      availableUsdc: addBaseUnits(poolStats.availableUsdc, body.amount),
    };
    return HttpResponse.json({
      provider: body.provider,
      amountUsdc: body.amount,
      sharesOut: body.amount,
      sharePrice: poolStats.sharePrice,
      txXdr: DEMO_XDR,
      message: "Mocked by MSW",
    });
  }),

  http.post(url("/pool/withdraw"), async ({ request }) => {
    await delay(LATENCY_MS);
    const body = (await request.json()) as { provider: string; shares: string };
    poolStats = {
      ...poolStats,
      totalUsdc: subBaseUnits(poolStats.totalUsdc, body.shares),
      availableUsdc: subBaseUnits(poolStats.availableUsdc, body.shares),
    };
    return HttpResponse.json({
      provider: body.provider,
      sharesIn: body.shares,
      usdcOut: body.shares,
      sharePrice: poolStats.sharePrice,
      txXdr: DEMO_XDR,
    });
  }),

  // --- Policies -----------------------------------------------------------
  http.get(url("/policies/types"), async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json({ coverageTypes: FIXTURE_COVERAGE_TYPES });
  }),

  http.get(url("/policies/holder/:address"), async ({ params }) => {
    await delay(LATENCY_MS);
    return HttpResponse.json({ policies: fixtureHolderPolicies(String(params.address)) });
  }),

  // --- Oracle -------------------------------------------------------------
  http.get(url("/oracle/status"), async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json({ readings: FIXTURE_ORACLE_READINGS });
  }),

  // --- Claims -------------------------------------------------------------
  http.get(url("/claims/recent"), async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json({ claims: FIXTURE_RECENT_CLAIMS });
  }),

  http.get(url("/claims/stats"), async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json(FIXTURE_CLAIM_STATS);
  }),

  http.get(url("/claims/holder/:address"), async ({ params }) => {
    await delay(LATENCY_MS);
    const holder = String(params.address);
    return HttpResponse.json({
      claims: fixtureClaimsForHolder(holder, fixtureHolderPolicies(holder)),
    });
  }),

  // --- Transactions -------------------------------------------------------
  http.post(url("/tx/submit"), async () => {
    await delay(LATENCY_MS);
    const response: SubmitTxResult = {
      confirmed: true,
      txHash: Date.now().toString(16).padStart(64, "0"),
    };
    return HttpResponse.json(response);
  }),
];
