/**
 * Public Entry Point for the Refract Realtime Layer (`@/lib/realtime`).
 *
 * Module Boundary Policy:
 * - External consumers (`src/app/**`, `src/components/**`, `src/hooks/**`, etc.)
 *   MUST import exclusively from `@/lib/realtime` (this barrel file).
 * - Deep imports into `@/lib/realtime/*` (e.g. `@/lib/realtime/client`) are
 *   prohibited outside `src/lib/realtime/**` and enforced via `.eslintrc.json`.
 * - Keep this barrel free of Node-only or DOM-only side effects at module evaluation
 *   time so Next.js App Router server and client bundles can safely import it.
 */

export { realtimeClient } from './client'

export const REALTIME_TOPICS = {
  ORACLE_UPDATE: 'oracle_update',
  CLAIMS_UPDATES: 'claims:updates',
  POLICIES_UPDATES: 'policies:updates',
  POOL_LIQUIDITY: 'pool:liquidity',
  GOVERNANCE_PROPOSALS: 'governance:proposals',
  NETWORK_HEALTH: 'network:health',
} as const

export type RealtimeTopicName =
  | (typeof REALTIME_TOPICS)[keyof typeof REALTIME_TOPICS]
  | (string & {})

export type RealtimeTopicHandler<T = unknown> = (payload: T) => void

export interface RealtimeMessageEnvelope<T = unknown> {
  topic: RealtimeTopicName
  payload: T
  timestamp?: number
  sequence?: number
}

export interface RealtimeBoundaryCheckResult {
  allowed: boolean
  reason?: string
}

const DEEP_IMPORT_PATTERNS = [
  /^@\/lib\/realtime\/.+/,
  /^(?:\.\.\/)+lib\/realtime\/(?!index(?:\.ts)?$).+/,
  /\/src\/lib\/realtime\/(?!index(?:\.ts)?$).+/,
]

/**
 * Validates whether `importerFilePath` is permitted to import `importSpecifier`
 * under the realtime module boundary rule.
 */
export function validateRealtimeModuleImport(
  importerFilePath: string,
  importSpecifier: string,
): RealtimeBoundaryCheckResult {
  const normalizedImporter = importerFilePath.replace(/\\/g, '/').trim()
  const specifier = importSpecifier.replace(/\\/g, '/').trim()

  const isInsideRealtimeLayer =
    normalizedImporter.includes('/src/lib/realtime/') ||
    normalizedImporter.startsWith('src/lib/realtime/')

  if (isInsideRealtimeLayer) {
    return { allowed: true }
  }

  const isDeepImport = DEEP_IMPORT_PATTERNS.some((pattern) =>
    pattern.test(specifier),
  )

  if (isDeepImport) {
    return {
      allowed: false,
      reason: `Deep import "${specifier}" from "${normalizedImporter}" violates the realtime module boundary. Import from "@/lib/realtime" instead.`,
    }
  }

  return { allowed: true }
}
