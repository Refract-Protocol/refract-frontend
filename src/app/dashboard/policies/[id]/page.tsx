"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useHolderPolicies } from "@/hooks/useHolderPolicies";
import { useOracleStatus } from "@/hooks/useOracleStatus";
import { useClaims } from "@/hooks/useClaims";
import { stellarExpertTxUrl } from "@/lib/stellar";
import { formatUsd, fromStroops } from "@/lib/format";
import { ORACLE_FEED_DISPLAY, oracleKeyForCoverageType } from "@/lib/oracle/feeds";

function formatDate(value: string | number | null | undefined, unit: "s" | "ms" = "ms"): string {
  if (value === undefined || value === null || value === "") return "—";
  const date =
    typeof value === "number" ? new Date(unit === "s" ? value * 1000 : value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const wallet = useWallet();
  const address = wallet.status === "connected" ? wallet.address : null;
  const { data: policies, loading: policiesLoading } = useHolderPolicies(address);
  const { data: readings, loading: oracleLoading, isFixture } = useOracleStatus();
  const claims = useClaims(address, policies);

  const policy = policies?.find((p) => String(p.id) === String(id)) ?? null;
  const oracleKey = policy ? oracleKeyForCoverageType(policy.coverageType) : null;
  const display = oracleKey ? (ORACLE_FEED_DISPLAY[oracleKey] ?? null) : null;
  const reading = readings?.find((r) => r.coverageType === oracleKey) ?? null;
  const claim = claims.find((c) => String(c.policyId) === String(id)) ?? null;

  const threshold = reading?.threshold ?? null;
  const currentValue = reading?.value ?? null;
  const triggered = Boolean(claim?.triggered);
  const expired = policy ? policy.expiresAt * 1000 < Date.now() : false;
  const status = triggered
    ? "paid"
    : expired
      ? "expired"
      : policy?.isActive
        ? "active"
        : "inactive";

  const progress =
    threshold !== null && currentValue !== null && threshold > 0
      ? Math.min(100, Math.max(0, (currentValue / threshold) * 100))
      : null;

  const loading = policiesLoading || oracleLoading;
  const txUrl = claim?.settlementTxHash ? stellarExpertTxUrl(claim.settlementTxHash) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>

      {!address ? (
        <p className="mt-6 text-gray-500">Connect your wallet to view this policy.</p>
      ) : loading ? (
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
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm capitalize">{status}</span>
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
                <dd>{policy.coverageTypeName}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Holder</dt>
                <dd className="font-mono break-all">{policy.holder}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Coverage amount</dt>
                <dd>{formatUsd(fromStroops(policy.coverageAmount))}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Premium</dt>
                <dd>{formatUsd(fromStroops(policy.premium))}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Duration</dt>
                <dd>{policy.durationDays} days</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Created</dt>
                <dd>{formatDate(policy.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Expiry</dt>
                <dd>{formatDate(policy.expiresAt, "s")}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-medium">Oracle trigger</h2>
            {!display ? (
              <p className="mt-2 text-gray-600">
                No live oracle feed is shown for {policy.coverageTypeName}.
              </p>
            ) : !reading ? (
              <p className="mt-2 text-gray-600">No current reading available for {display.feed}.</p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{display.feed} reading</span>
                  <span className="font-medium">
                    {display.formatValue(reading)} / {threshold}
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
                <p className="text-sm text-gray-600">{reading.message}</p>
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
                  <dd>{claim.triggered ? "Paid out" : "Not triggered"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Payout</dt>
                  <dd>{formatUsd(fromStroops(claim.payout))}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-sm text-gray-500">Transaction</dt>
                  <dd>
                    {txUrl ? (
                      <a
                        href={txUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-blue-600 hover:underline break-all"
                      >
                        {claim.settlementTxHash}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            ) : expired ? (
              <p className="mt-2 text-gray-600">This policy expired without a payout.</p>
            ) : (
              <p className="mt-2 text-gray-600">No settlement yet — this policy is still active.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
