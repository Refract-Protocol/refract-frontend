export interface ProtocolParametersSnapshot {
  version: number
  updatedAt: number
  poolCapacityCeilingUsd: number
  protocolFeeBps: number
  lpPremiumShareBps: number
  supportedRiskClasses: string[]
  coverageLimitsByRiskClass: Record<string, number>
}

export interface ProtocolFormValidationResult {
  valid: boolean
  warningMessage: string | null
  clampedCoverageAmountUsd?: number
  clampedDepositAmountUsd?: number
}

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'version',
  'updatedAt',
  'poolCapacityCeilingUsd',
  'protocolFeeBps',
  'lpPremiumShareBps',
  'supportedRiskClasses',
  'coverageLimitsByRiskClass',
])

export const DEFAULT_PROTOCOL_PARAMETERS: ProtocolParametersSnapshot = {
  version: 1,
  updatedAt: 0,
  poolCapacityCeilingUsd: 10_000_000,
  protocolFeeBps: 250,
  lpPremiumShareBps: 9_000,
  supportedRiskClasses: [
    'validator-slashing',
    'smart-contract-exploit',
    'depeg-usdc',
  ],
  coverageLimitsByRiskClass: {
    'validator-slashing': 1_000_000,
    'smart-contract-exploit': 750_000,
    'depeg-usdc': 2_000_000,
  },
}

/**
 * Runtime schema validator for `protocol.params` snapshot payloads.
 * Rejects partial, malformed, or unknown-key payloads safely.
 */
export function validateProtocolParametersPayload(
  candidate: unknown,
): { ok: true; value: ProtocolParametersSnapshot } | { ok: false; reason: string } {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, reason: 'Payload must be a non-null JSON object' }
  }

  const obj = candidate as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return { ok: false, reason: `Unknown top-level parameter key "${key}"` }
    }
  }

  for (const requiredKey of ALLOWED_TOP_LEVEL_KEYS) {
    if (!(requiredKey in obj)) {
      return { ok: false, reason: `Missing required parameter field "${requiredKey}"` }
    }
  }

  if (
    typeof obj.version !== 'number' ||
    !Number.isSafeInteger(obj.version) ||
    obj.version < 1
  ) {
    return { ok: false, reason: 'version must be a positive safe integer' }
  }

  if (typeof obj.updatedAt !== 'number' || !Number.isFinite(obj.updatedAt)) {
    return { ok: false, reason: 'updatedAt must be a finite timestamp' }
  }

  if (
    typeof obj.poolCapacityCeilingUsd !== 'number' ||
    !Number.isFinite(obj.poolCapacityCeilingUsd) ||
    obj.poolCapacityCeilingUsd <= 0
  ) {
    return { ok: false, reason: 'poolCapacityCeilingUsd must be a positive number' }
  }

  if (
    typeof obj.protocolFeeBps !== 'number' ||
    obj.protocolFeeBps < 0 ||
    obj.protocolFeeBps > 10_000 ||
    typeof obj.lpPremiumShareBps !== 'number' ||
    obj.lpPremiumShareBps < 0 ||
    obj.lpPremiumShareBps > 10_000
  ) {
    return { ok: false, reason: 'Fee and share basis points must be within [0, 10000]' }
  }

  if (
    !Array.isArray(obj.supportedRiskClasses) ||
    obj.supportedRiskClasses.length === 0 ||
    !obj.supportedRiskClasses.every((r) => typeof r === 'string' && r.trim().length > 0)
  ) {
    return { ok: false, reason: 'supportedRiskClasses must be a non-empty string array' }
  }

  if (
    obj.coverageLimitsByRiskClass === null ||
    typeof obj.coverageLimitsByRiskClass !== 'object' ||
    Array.isArray(obj.coverageLimitsByRiskClass)
  ) {
    return { ok: false, reason: 'coverageLimitsByRiskClass must be a record of numbers' }
  }

  const limitsRecord = obj.coverageLimitsByRiskClass as Record<string, unknown>
  const validatedLimits: Record<string, number> = {}
  for (const [riskClass, limit] of Object.entries(limitsRecord)) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      return {
        ok: false,
        reason: `Invalid coverage limit for risk class "${riskClass}"`,
      }
    }
    validatedLimits[riskClass] = limit
  }

  return {
    ok: true,
    value: {
      version: obj.version,
      updatedAt: obj.updatedAt,
      poolCapacityCeilingUsd: obj.poolCapacityCeilingUsd,
      protocolFeeBps: obj.protocolFeeBps,
      lpPremiumShareBps: obj.lpPremiumShareBps,
      supportedRiskClasses: [...(obj.supportedRiskClasses as string[])],
      coverageLimitsByRiskClass: validatedLimits,
    },
  }
}

/**
 * Shared `protocol.params` store with monotonic version guards and inline
 * form clamping/warning evaluation when a live parameter ceiling changes.
 */
export class ProtocolParametersStore {
  public static readonly TOPIC = 'protocol.params'

  private snapshot: ProtocolParametersSnapshot
  private readonly listeners = new Set<
    (snapshot: ProtocolParametersSnapshot) => void
  >()

  constructor(initialSeed: ProtocolParametersSnapshot = DEFAULT_PROTOCOL_PARAMETERS) {
    this.snapshot = {
      ...initialSeed,
      supportedRiskClasses: [...initialSeed.supportedRiskClasses],
      coverageLimitsByRiskClass: { ...initialSeed.coverageLimitsByRiskClass },
    }
  }

  public getSnapshot(): ProtocolParametersSnapshot {
    return this.snapshot
  }

  public subscribe(
    listener: (snapshot: ProtocolParametersSnapshot) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public applyIncomingPayload(rawPayload: unknown): {
    applied: boolean
    reason?: string
  } {
    const validated = validateProtocolParametersPayload(rawPayload)
    if (!validated.ok) {
      return { applied: false, reason: validated.reason }
    }

    const incoming = validated.value
    if (incoming.version < this.snapshot.version) {
      return { applied: false, reason: 'Out-of-order older parameter version' }
    }
    if (
      incoming.version === this.snapshot.version &&
      incoming.updatedAt < this.snapshot.updatedAt
    ) {
      return { applied: false, reason: 'Out-of-order older parameter timestamp' }
    }

    this.snapshot = incoming
    for (const listener of Array.from(this.listeners)) {
      listener(this.snapshot)
    }
    return { applied: true }
  }

  /**
   * Validates in-progress `/cover` or `/provide` form inputs against the current
   * live parameters, returning an inline warning and clamped value when a pushed
   * ceiling lowers below the user's entered amount.
   */
  public evaluateInProgressForm(input: {
    riskClass?: string
    coverageAmountUsd?: number
    depositAmountUsd?: number
  }): ProtocolFormValidationResult {
    if (input.riskClass !== undefined) {
      if (!this.snapshot.supportedRiskClasses.includes(input.riskClass)) {
        return {
          valid: false,
          warningMessage: `Risk class "${input.riskClass}" is no longer supported by protocol parameters.`,
        }
      }

      const limit = this.snapshot.coverageLimitsByRiskClass[input.riskClass]
      if (
        typeof limit === 'number' &&
        typeof input.coverageAmountUsd === 'number' &&
        input.coverageAmountUsd > limit
      ) {
        return {
          valid: false,
          warningMessage: `Coverage limit for ${input.riskClass} was updated to $${limit.toLocaleString('en-US')}. Your input has been clamped to the new maximum.`,
          clampedCoverageAmountUsd: limit,
        }
      }
    }

    if (
      typeof input.depositAmountUsd === 'number' &&
      input.depositAmountUsd > this.snapshot.poolCapacityCeilingUsd
    ) {
      const cap = this.snapshot.poolCapacityCeilingUsd
      return {
        valid: false,
        warningMessage: `Pool capacity ceiling was updated to $${cap.toLocaleString('en-US')}. Your deposit has been clamped to the new ceiling.`,
        clampedDepositAmountUsd: cap,
      }
    }

    return {
      valid: true,
      warningMessage: null,
      clampedCoverageAmountUsd: input.coverageAmountUsd,
      clampedDepositAmountUsd: input.depositAmountUsd,
    }
  }
}
