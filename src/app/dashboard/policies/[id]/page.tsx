"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useHolderPolicies } from "@/hooks/useHolderPolicies";
import { useOracleStatus } from "@/hooks/useOracleStatus";
import { useClaims } from "@/hooks/useClaims";
import { stellarExpertTxUrl } from "@/lib/stellar";
import { ORACLE_FEED_DISPLAY } from "@/app/page";

function formatDate(value?: string | number | null): string {
  if (value === undefined || value === null || value === "") return "—";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatAmount(value?: string | number | null): string {
  if (value === undefined || value === null || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString();
}

function feedDisplay(coverageType?: string) {
  if (!coverageType) return null;
  return ORACLE_FEED_DISPLAY[coverageType] ?? null;
}

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: policies, loading: policiesLoading } = useHolderPolicies();
  const { data: readings, loading: oracleLoading, isFixture } = useOracleStatus();
  const { data: claims, loading: claimsLoading } = useClaims();

  const policy = policies?.find((p) => String(p.id) === String(id)) ?? null;
  const coverageType = policy?.coverageType ?? policy?.coverage_type;
  const display = feedDisplay(coverageType);
  const reading = readings?.find((r) => r.coverageType === coverageType) ?? null;
  const claim = claims?.find((c) => String(c.policyId) === String(id)) ?? null;

  const threshold = policy?.threshold ?? reading?.threshold ?? null;
  const currentValue = reading?.value ?? null;
  const triggered = policy?.status === "triggered" || policy?.status === "paid" || Boolean(claim);
  const expired = policy?.expiry ? new Date(policy.expiry).getTime() < Date.now() : false;

  const progress =
    threshold !== null && currentValue !== null && Number(threshold) > 0
      ? Math.min(100, Math.max(0, (Number(currentValue) / Number(threshold)) * 100))
      : null;

  const loading = policiesLoading || oracleLoading || claimsLoading;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>

      {loading ? (
        <p className="mt-6 text-gray-500">Loading policy…</p>
      ) : !policy ? (
        <div className="mt-6 rounded-lg border border-gray-200 p-6">
          <h1 className="text-xl font-semibold">Policy not found</h1>
          <p className="mt-2 text-gray-600">
            No policy matches id <span className="font-mono">{id}</span>.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Policy #{policy.id}</h1>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm capitalize">
              {policy.status ?? "unknown"}
            </span>
          </div>

          <section className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-medium">Policy details</h2>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-gray-500">Policy ID</dt>
                <dd className="font-mono">{policy.id}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Coverage type</dt>
                <dd>{display?.label ?? coverageType ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Holder</dt>
                <dd className="font-mono break-all">{policy.holder ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Coverage amount</dt>
                <dd>{formatAmount(policy.coverageAmount ?? policy.coverage_amount)}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Premium</dt>
                <dd>{formatAmount(policy.premium)}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Duration</dt>
                <dd>{policy.duration ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Created</dt>
                <dd>{formatDate(policy.createdAt ?? policy.created_at)}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Expiry</dt>
                <dd>{formatDate(policy.expiry)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-medium">Oracle trigger</h2>
            {!display ? (
              <p className="mt-2 text-gray-600">
                No oracle feed is configured for coverage type{" "}
                <span className="font-mono">{coverageType ?? "unknown"}</span>.
              </p>
            ) : !reading ? (
              <p className="mt-2 text-gray-600">
                No current reading available for {display.label}.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{display.label} reading</span>
                  <span className="font-medium">
                    {formatAmount(currentValue)}
                    {threshold !== null ? ` / ${formatAmount(threshold)}` : ""}
                  </span>
                </div>
                {progress !== null && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${triggered ? "bg-green-500" : "bg-blue-500"}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
                <p className="text-sm text-gray-600">
                  {triggered
                    ? "Threshold reached — this policy has triggered."
                    : progress !== null
                      ? `${progress.toFixed(0)}% of the way to the payout threshold.`
                      : "Threshold data unavailable."}
                </p>
                {isFixture && (
                  <p className="text-xs text-amber-600">Showing fixture oracle data.</p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-medium">Settlement</h2>
            {claim ? (
              <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-gray-500">Status</dt>
                  <dd className="capitalize">{claim.status ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Payout</dt>
                  <dd>{formatAmount(claim.amount)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-sm text-gray-500">Transaction</dt>
                  <dd>
                    {claim.txHash ? (
                      <a
                        href={stellarExpertTxUrl(claim.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-blue-600 hover:underline break-all"
                      >
                        {claim.txHash}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            ) : expired ? (
              <p className="mt-2 text-gray-600">
                This policy expired without a payout.
              </p>
            ) : (
              <p className="mt-2 text-gray-600">
                No settlement yet — this policy is still active.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
