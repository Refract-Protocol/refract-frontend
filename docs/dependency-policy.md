# Dependency & Vulnerability Policy

This document defines how we manage dependency updates and triage security
vulnerabilities for this wallet-integrated financial dApp.

## Automated update automation

Dependabot is configured in [`.github/dependabot.yml`](../.github/dependabot.yml)
for the `npm` ecosystem with a **weekly** update schedule.

Updates are grouped by risk category to keep PR noise low while ensuring that
security-relevant production dependencies still get individual review:

- **Grouped (low risk):** patch/minor bumps of `devDependencies` are grouped
  into a single PR per week.
- **Ungrouped (individual review required):** major version bumps and
  security-relevant production dependencies — in particular
  `@stellar/freighter-api` and `next` — are left ungrouped so each is reviewed
  on its own.

## Vulnerability scanning in CI

The `audit` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
runs `npm audit --audit-level=high` on every push and pull request. The build
**fails** on any high or critical severity finding that has an available fix.

## Exception process

Some advisories have **no available upstream fix** and/or negligible real
exploitability in this app's context. Blocking CI on those would be a
false-positive gate. To allowlist such a finding you must:

1. Add an entry to [`audit-ci.jsonc`](../audit-ci.jsonc) under `allowlist`.
2. Include a **required justification comment** on the same line explaining:
   - the advisory ID (GHSA / CVE),
   - why there is no available fix, and
   - why the finding is not exploitable in this app's context.
3. Reference the tracking issue for the follow-up fix.

Allowlist entries are reviewed on every dependency update and must be removed
once an upstream fix is available.

## High-priority packages

The following packages are **high priority** and warrant expedited review
because of their centrality to the app's security and correctness:

| Package | Reason |
| --- | --- |
| `@stellar/freighter-api` | Direct wallet integration; a vulnerability here can compromise signing/keys. |
| `next` | Application framework; security advisories affect the whole app surface. |
| Stellar SDK ecosystem (`@stellar/stellar-sdk`, `@stellar/stellar-base`, etc.) | Transaction building/signing correctness and network security. |

For these packages:

- Security advisories are triaged **within one business day** of disclosure.
- Patch/minor security fixes are merged as soon as CI is green, without waiting
  for the weekly Dependabot cadence.
- Major upgrades are scheduled deliberately and tested against the wallet and
  transaction flows before merge.

## Triage workflow

1. Dependabot or the CI `audit` job surfaces a finding.
2. Determine severity and whether an upstream fix exists.
3. If a fix exists: update the dependency (expedite for high-priority packages).
4. If no fix exists: add a justified allowlist entry per the exception process
   above and open a follow-up issue to track the upstream fix.
5. Remove allowlist entries once the fix lands.
