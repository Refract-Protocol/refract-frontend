/**
 * Domain-mapping layer translating raw backend realtime wire payloads into
 * frontend REST-compatible domain models (#261).
 *
 * Pure, side-effect-free mappers per topic family returning an explicit
 * `{ ok: true, value } | { ok: false, reason }` result so UI hooks never
 * couple to wire field names or coerce invalid values.
 */

import type { OracleReading } from '../../api/oracle'
import type { ClaimRecord } from '../../api/claims'
import type { PoolStats } from '../../api/pool'

export type DomainMapperResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string }

export interface RealtimeNotificationDomainModel {
  id: string
  type: 'claim_settled' | 'policy_expiring' | 'oracle_alert' | 'system'
  title: string
  message: string
  createdAt: number
  read: boolean
}

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const VALID_NOTIFICATION_TYPES = new Set([
  'claim_settled',
  'policy_expiring',
  'oracle_alert',
  'system',
])

/**
 * Maps a raw oracle realtime payload into the `OracleReading` domain model
 * used by `useOracleStatus`.
 */
export function mapOracleRealtimePayload(
  raw: unknown
): DomainMapperResult<OracleReading> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'Oracle payload must be an object' }
  }

  const coverageType = readNonEmptyString(
    raw.coverageType ?? raw.coverage_type
  )
  if (!coverageType) {
    return { ok: false, reason: 'Missing or invalid oracle coverageType' }
  }

  const value = readFiniteNumber(raw.value)
  if (value === null) {
    return { ok: false, reason: 'Missing or non-numeric oracle value' }
  }

  const threshold = readFiniteNumber(raw.threshold)
  if (threshold === null) {
    return { ok: false, reason: 'Missing or non-numeric oracle threshold' }
  }

  const rawSeverity = readNonEmptyString(raw.severity)?.toLowerCase()
  if (!rawSeverity || !VALID_SEVERITIES.has(rawSeverity)) {
    return { ok: false, reason: 'Missing or invalid oracle severity enum' }
  }

  const message = readNonEmptyString(raw.message)
  if (!message) {
    return { ok: false, reason: 'Missing or empty oracle message' }
  }

  return {
    ok: true,
    value: {
      coverageType: coverageType as OracleReading['coverageType'],
      type: 'oracle_update',
      value,
      threshold,
      severity: rawSeverity as OracleReading['severity'],
      message,
    },
  }
}

/**
 * Maps a raw claim settlement realtime payload into the `ClaimRecord` domain
 * model used by `useClaims` and `useRecentClaims`.
 */
export function mapClaimRealtimePayload(
  raw: unknown
): DomainMapperResult<ClaimRecord> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'Claim payload must be an object' }
  }

  const policyId = readPositiveInt(raw.policyId ?? raw.policy_id)
  if (policyId === null) {
    return { ok: false, reason: 'Missing or invalid claim policyId' }
  }

  const holder = readNonEmptyString(raw.holder ?? raw.claimant)
  if (!holder) {
    return { ok: false, reason: 'Missing or invalid claim holder address' }
  }

  const coverageType = readNonEmptyString(
    raw.coverageType ?? raw.coverage_type
  )
  if (!coverageType) {
    return { ok: false, reason: 'Missing or invalid claim coverageType' }
  }

  const triggered =
    typeof raw.triggered === 'boolean' ? raw.triggered : null
  if (triggered === null) {
    return { ok: false, reason: 'Missing boolean triggered flag on claim' }
  }

  const payout = readBaseUnitString(raw.payout ?? raw.payout_amount)
  if (payout === null) {
    return { ok: false, reason: 'Missing or invalid base-unit claim payout string' }
  }

  const reason = readNonEmptyString(raw.reason)
  if (!reason) {
    return { ok: false, reason: 'Missing or invalid claim reason' }
  }

  const processedAt = readEpochMillis(raw.processedAt ?? raw.processed_at)
  if (processedAt === null) {
    return { ok: false, reason: 'Missing or invalid claim processedAt timestamp' }
  }

  return {
    ok: true,
    value: {
      policyId,
      holder,
      coverageType: coverageType as ClaimRecord['coverageType'],
      triggered,
      payout,
      reason,
      processedAt,
    },
  }
}

/**
 * Maps a raw pool stats realtime payload into the `PoolStats` domain model
 * used by `usePoolStats`. Preserves stroop amounts as strings to avoid float precision loss.
 */
export function mapPoolStatsRealtimePayload(
  raw: unknown
): DomainMapperResult<PoolStats> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'PoolStats payload must be an object' }
  }

  const totalUsdc = readBaseUnitString(raw.totalUsdc ?? raw.total_usdc)
  const totalShares = readBaseUnitString(raw.totalShares ?? raw.total_shares)
  const lockedUsdc = readBaseUnitString(raw.lockedUsdc ?? raw.locked_usdc)
  const premiumAccrued = readBaseUnitString(
    raw.premiumAccrued ?? raw.premium_accrued
  )
  const availableUsdc = readBaseUnitString(
    raw.availableUsdc ?? raw.available_usdc
  )

  if (
    totalUsdc === null ||
    totalShares === null ||
    lockedUsdc === null ||
    premiumAccrued === null ||
    availableUsdc === null
  ) {
    return {
      ok: false,
      reason: 'Missing or invalid base-unit string amount in PoolStats payload',
    }
  }

  const utilizationBps = readFiniteNumber(
    raw.utilizationBps ?? raw.utilization_bps
  )
  const apyBps = readFiniteNumber(raw.apyBps ?? raw.apy_bps)
  const sharePrice = readFiniteNumber(raw.sharePrice ?? raw.share_price)
  const maxUtilizationBps = readFiniteNumber(
    raw.maxUtilizationBps ?? raw.max_utilization_bps
  )

  if (
    utilizationBps === null ||
    apyBps === null ||
    sharePrice === null ||
    maxUtilizationBps === null
  ) {
    return {
      ok: false,
      reason: 'Missing or non-numeric ratio/bps field in PoolStats payload',
    }
  }

  return {
    ok: true,
    value: {
      totalUsdc,
      totalShares,
      lockedUsdc,
      premiumAccrued,
      availableUsdc,
      utilizationBps,
      apyBps,
      sharePrice,
      maxUtilizationBps,
    },
  }
}

/**
 * Maps a raw notification realtime payload into `RealtimeNotificationDomainModel`.
 */
export function mapNotificationRealtimePayload(
  raw: unknown
): DomainMapperResult<RealtimeNotificationDomainModel> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'Notification payload must be an object' }
  }

  const id = readNonEmptyString(raw.id ?? raw.notification_id)
  const rawType = readNonEmptyString(raw.type)?.toLowerCase()
  const title = readNonEmptyString(raw.title)
  const message = readNonEmptyString(raw.message ?? raw.body)
  const createdAt = readEpochMillis(raw.createdAt ?? raw.created_at)

  if (!id || !rawType || !VALID_NOTIFICATION_TYPES.has(rawType) || !title || !message || createdAt === null) {
    return { ok: false, reason: 'Missing or invalid fields in notification payload' }
  }

  return {
    ok: true,
    value: {
      id,
      type: rawType as RealtimeNotificationDomainModel['type'],
      title,
      message,
      createdAt,
      read: typeof raw.read === 'boolean' ? raw.read : false,
    },
  }
}

/**
 * Dispatches a raw payload to the appropriate topic mapper based on topic prefix.
 */
export function mapTopicPayloadToDomain(
  topic: string,
  raw: unknown
): DomainMapperResult<
  OracleReading | ClaimRecord | PoolStats | RealtimeNotificationDomainModel
> {
  const family = topic.trim().split(':', 1)[0]?.toLowerCase()
  switch (family) {
    case 'oracle':
      return mapOracleRealtimePayload(raw)
    case 'claims':
      return mapClaimRealtimePayload(raw)
    case 'pool':
      return mapPoolStatsRealtimePayload(raw)
    case 'notifications':
      return mapNotificationRealtimePayload(raw)
    default:
      return {
        ok: false,
        reason: `Unsupported realtime topic family: "${family || topic}"`,
      }
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function readNonEmptyString(val: unknown): string | null {
  if (typeof val !== 'string') return null
  const trimmed = val.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val
  }
  return null
}

function readPositiveInt(val: unknown): number | null {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0) {
    return val
  }
  return null
}

/**
 * Normalizes base-unit stroop amounts to decimal integer strings without
 * allowing floating-point numbers that could lose precision.
 */
function readBaseUnitString(val: unknown): string | null {
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (/^\d+$/.test(trimmed)) {
      return trimmed
    }
    return null
  }
  if (typeof val === 'bigint' && val >= BigInt(0)) {
    return val.toString()
  }
  return null
}

/**
 * Normalizes either epoch milliseconds or an ISO-8601 timestamp string into epoch milliseconds.
 */
function readEpochMillis(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return Math.trunc(val)
  }
  if (typeof val === 'string' && val.trim().length > 0) {
    const parsed = Date.parse(val)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}
