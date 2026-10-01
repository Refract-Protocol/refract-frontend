import { fromStroops, formatUsd } from "@/lib/format";
import type { Policy } from "@/lib/api/policies";
import type { ClaimRecord } from "@/lib/api/claims";

export interface ExportDataset {
  address: string;
  policies: Policy[];
  claims: ClaimRecord[];
}

/**
 * Escapes a single CSV field per RFC 4180: fields containing a comma, a
 * double quote, or a newline are wrapped in double quotes, and any embedded
 * double quote is doubled. Everything else is returned verbatim.
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Joins a row of values into a single CSV line. */
export function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsvValue).join(",");
}

/** Formats a base-unit amount as human-readable USD, e.g. "$1,234.56". */
export function formatAmount(stroops: string | number | null | undefined): string {
  if (stroops === null || stroops === undefined || stroops === "") return "";
  const numeric = typeof stroops === "number" ? stroops : Number(stroops);
  if (!Number.isFinite(numeric)) return "";
  return formatUsd(fromStroops(numeric));
}

const POLICY_HEADERS = [
  "Policy ID",
  "Policyholder",
  "Coverage Amount (USD)",
  "Premium (USD)",
  "Status",
  "Start Date",
  "End Date",
];

const CLAIM_HEADERS = [
  "Claim ID",
  "Policy ID",
  "Claimant",
  "Claim Amount (USD)",
  "Status",
  "Reason",
  "Filed At",
];

function policyRow(policy: Policy): string {
  return toCsvRow([
    policy.id,
    policy.holder,
    formatAmount(policy.coverageAmount),
    formatAmount(policy.premium),
    policy.status,
    policy.startDate,
    policy.endDate,
  ]);
}

function claimRow(claim: ClaimRecord): string {
  return toCsvRow([
    claim.id,
    claim.policyId,
    claim.claimant,
    formatAmount(claim.amount),
    claim.status,
    claim.reason,
    claim.filedAt,
  ]);
}

/**
 * Builds a CSV document containing both the policy and claim history for a
 * holder. Pure function: no DOM/browser APIs, so it is trivially unit
 * testable. Amounts are emitted in human-readable USD rather than raw
 * base-unit strings.
 */
export function buildPolicyHistoryCsv(dataset: ExportDataset): string {
  const lines: string[] = [];
  lines.push("Policies");
  lines.push(toCsvRow(POLICY_HEADERS));
  for (const policy of dataset.policies) lines.push(policyRow(policy));
  lines.push("");
  lines.push("Claims");
  lines.push(toCsvRow(CLAIM_HEADERS));
  for (const claim of dataset.claims) lines.push(claimRow(claim));
  return lines.join("\r\n");
}

/**
 * Builds a JSON document containing both the policy and claim history for a
 * holder. Amounts are emitted in human-readable USD alongside the raw
 * base-unit value so the export is self-describing. Pure function.
 */
export function buildPolicyHistoryJson(dataset: ExportDataset): string {
  const payload = {
    address: dataset.address,
    exportedAt: new Date().toISOString(),
    policies: dataset.policies.map((policy) => ({
      ...policy,
      coverageAmountUsd: formatAmount(policy.coverageAmount),
      premiumUsd: formatAmount(policy.premium),
    })),
    claims: dataset.claims.map((claim) => ({
      ...claim,
      amountUsd: formatAmount(claim.amount),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Browser-only wrapper: triggers a file download for the given text content
 * using a Blob and an object URL. Kept separate from the pure builders so
 * the generation logic stays DOM-free and testable.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
