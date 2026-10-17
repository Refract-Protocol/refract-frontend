/**
 * Hierarchical topic grammar, pattern compilation, and wildcard subscription
 * router for the realtime layer (#269).
 *
 * Grammar:
 * - Segments are separated by `:` (e.g. `oracle:XLM/USD`, `claims:GABC:policy-12`).
 * - `*` matches exactly one non-empty segment (e.g. `oracle:*`, `claims:*:settled`).
 * - `**` as the terminal segment matches one or more trailing segments (e.g. `pool:main:**`).
 */

export class TopicPatternValidationError extends Error {
  readonly pattern: string

  constructor(pattern: string, reason: string) {
    super(`Invalid realtime topic pattern "${pattern}": ${reason}`)
    this.name = 'TopicPatternValidationError'
    this.pattern = pattern
  }
}

export interface CompiledTopicPattern {
  readonly raw: string
  readonly isWildcard: boolean
  readonly segments: readonly string[]
  readonly hasMultiLevelTail: boolean
  matches(concreteTopic: string): boolean
}

const VALID_LITERAL_SEGMENT = /^[A-Za-z0-9._/-]+$/

/**
 * Validates and compiles a topic subscription pattern once at subscribe time.
 * Throws `TopicPatternValidationError` if the pattern is malformed.
 */
export function compileTopicPattern(pattern: string): CompiledTopicPattern {
  const trimmed = pattern.trim()
  if (!trimmed) {
    throw new TopicPatternValidationError(pattern, 'Pattern must not be empty')
  }

  const segments = trimmed.split(':')
  if (segments.length < 2) {
    throw new TopicPatternValidationError(
      pattern,
      'Pattern must contain at least a family prefix and target segment separated by ":"'
    )
  }

  let isWildcard = false
  let hasMultiLevelTail = false

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) {
      throw new TopicPatternValidationError(
        pattern,
        'Empty segment ("") is not allowed'
      )
    }

    if (i === 0 && (seg === '*' || seg === '**')) {
      throw new TopicPatternValidationError(
        pattern,
        'Top-level topic family cannot be a wildcard'
      )
    }

    if (seg === '**') {
      if (i !== segments.length - 1) {
        throw new TopicPatternValidationError(
          pattern,
          'Multi-level wildcard "**" is only allowed as the final segment'
        )
      }
      isWildcard = true
      hasMultiLevelTail = true
      continue
    }

    if (seg === '*') {
      isWildcard = true
      continue
    }

    if (seg.includes('*')) {
      throw new TopicPatternValidationError(
        pattern,
        `Partial segment wildcard "${seg}" is not supported; use "*" or "**" for full segments`
      )
    }

    if (!VALID_LITERAL_SEGMENT.test(seg)) {
      throw new TopicPatternValidationError(
        pattern,
        `Segment "${seg}" contains unsupported characters`
      )
    }
  }

  const frozenSegments = Object.freeze(segments.slice())

  return {
    raw: trimmed,
    isWildcard,
    segments: frozenSegments,
    hasMultiLevelTail,
    matches(concreteTopic: string): boolean {
      const target = concreteTopic.trim()
      if (!target || target.includes('*')) {
        return false
      }
      if (!isWildcard) {
        return target === trimmed
      }

      const targetSegments = target.split(':')
      if (hasMultiLevelTail) {
        // Requires at least as many segments as the pattern (`**` matches >= 1 segment)
        if (targetSegments.length < frozenSegments.length) {
          return false
        }
        for (let i = 0; i < frozenSegments.length - 1; i++) {
          const patSeg = frozenSegments[i]
          const tgtSeg = targetSegments[i]
          if (!tgtSeg) return false
          if (patSeg !== '*' && patSeg !== tgtSeg) {
            return false
          }
        }
        // Ensure trailing segments are non-empty
        for (let i = frozenSegments.length - 1; i < targetSegments.length; i++) {
          if (!targetSegments[i]) return false
        }
        return true
      }

      if (targetSegments.length !== frozenSegments.length) {
        return false
      }
      for (let i = 0; i < frozenSegments.length; i++) {
        const patSeg = frozenSegments[i]
        const tgtSeg = targetSegments[i]
        if (!tgtSeg) return false
        if (patSeg !== '*' && patSeg !== tgtSeg) {
          return false
        }
      }
      return true
    },
  }
}

export type TopicPatternListener<TPayload = unknown> = (
  concreteTopic: string,
  payload: TPayload
) => void

export interface TopicPatternRouterOptions {
  /** Maximum distinct patterns allowed to prevent pathological matcher growth (default: 256). */
  maxPatterns?: number
  /** Whether the upstream backend natively supports wildcard subscriptions (default: false). */
  serverSupportsWildcards?: boolean
}

interface PatternSlot<TPayload> {
  compiled: CompiledTopicPattern
  listeners: Set<TopicPatternListener<TPayload>>
}

export class TopicPatternRouter<TPayload = unknown> {
  private readonly maxPatterns: number
  private readonly serverSupportsWildcards: boolean
  private readonly slots = new Map<string, PatternSlot<TPayload>>()

  constructor(options: TopicPatternRouterOptions = {}) {
    this.maxPatterns = Math.max(1, options.maxPatterns ?? 256)
    this.serverSupportsWildcards = options.serverSupportsWildcards ?? false
  }

  /**
   * Registers a listener for an exact or wildcard topic pattern.
   * Returns an unsubscribe function.
   */
  subscribe(
    pattern: string,
    listener: TopicPatternListener<TPayload>
  ): () => void {
    const compiled = compileTopicPattern(pattern)
    let slot = this.slots.get(compiled.raw)

    if (!slot) {
      if (this.slots.size >= this.maxPatterns) {
        throw new Error(
          `Maximum realtime pattern subscription limit (${this.maxPatterns}) reached`
        )
      }
      slot = {
        compiled,
        listeners: new Set(),
      }
      this.slots.set(compiled.raw, slot)
    }

    slot.listeners.add(listener)

    return () => {
      const current = this.slots.get(compiled.raw)
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0) {
        this.slots.delete(compiled.raw)
      }
    }
  }

  /**
   * Routes an inbound concrete topic message to all matching subscriptions.
   * Guarantees that any single listener function is invoked AT MOST ONCE per
   * message even if registered under both an exact topic and a wildcard pattern.
   */
  route(concreteTopic: string, payload: TPayload): number {
    const deliveredListeners = new Set<TopicPatternListener<TPayload>>()

    for (const slot of this.slots.values()) {
      if (slot.compiled.matches(concreteTopic)) {
        for (const listener of slot.listeners) {
          deliveredListeners.add(listener)
        }
      }
    }

    for (const listener of deliveredListeners) {
      listener(concreteTopic, payload)
    }

    return deliveredListeners.size
  }

  /**
   * Computes the set of outbound topic strings to send on the wire.
   * When `serverSupportsWildcards` is false, expands wildcard patterns against
   * `knownConcreteTopics`.
   */
  resolveWireSubscriptions(knownConcreteTopics: readonly string[] = []): string[] {
    const wireTopics = new Set<string>()
    for (const slot of this.slots.values()) {
      if (!slot.compiled.isWildcard || this.serverSupportsWildcards) {
        wireTopics.add(slot.compiled.raw)
      } else {
        for (const candidate of knownConcreteTopics) {
          if (slot.compiled.matches(candidate)) {
            wireTopics.add(candidate)
          }
        }
      }
    }
    return Array.from(wireTopics).sort()
  }

  getPatternCount(): number {
    return this.slots.size
  }
}
