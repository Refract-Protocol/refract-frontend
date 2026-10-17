/**
 * Delta/patch protocol and revision-checked patch applier for high-churn
 * realtime topics (#291).
 *
 * Allows topics (`oracle`, `pool`, etc.) to transmit compact field-level diffs
 * carrying `base_revision` and `revision` alongside full snapshots, rejecting
 * revision gaps without state corruption and triggering snapshot resyncs.
 */

export interface RealtimeSnapshotFrame<TState extends Record<string, unknown> = Record<string, unknown>> {
  type: 'snapshot'
  topic: string
  revision: number
  payload: TState
}

export interface RealtimePatchFrame<TPatch extends Record<string, unknown> = Record<string, unknown>> {
  type: 'patch'
  topic: string
  base_revision: number
  revision: number
  patch: TPatch
}

export type RevisionedTopicFrame<TState extends Record<string, unknown> = Record<string, unknown>> =
  | RealtimeSnapshotFrame<TState>
  | RealtimePatchFrame<Partial<TState>>

export type PatchApplicationResult<TState> =
  | {
      status: 'applied'
      state: TState
      revision: number
    }
  | {
      status: 'ignored_stale_or_duplicate'
      state: TState
      revision: number
    }
  | {
      status: 'rejected_revision_gap'
      state: TState
      revision: number
      expectedBaseRevision: number | null
      receivedBaseRevision: number
    }
  | {
      status: 'rejected_malformed'
      state: TState | null
      revision: number | null
      reason: string
    }

/**
 * Pure, non-mutating patch applier `(currentState, currentRevision, patchFrame) => PatchApplicationResult`.
 */
export function applyRevisionedPatch<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(
  currentState: TState | null,
  currentRevision: number | null,
  frame: unknown
): PatchApplicationResult<TState> {
  if (!isPlainObject(frame)) {
    return {
      status: 'rejected_malformed',
      state: currentState,
      revision: currentRevision,
      reason: 'Patch frame must be an object',
    }
  }

  const baseRevision = frame.base_revision
  const targetRevision = frame.revision
  const patch = frame.patch

  if (
    typeof baseRevision !== 'number' ||
    !Number.isInteger(baseRevision) ||
    baseRevision < 0 ||
    typeof targetRevision !== 'number' ||
    !Number.isInteger(targetRevision) ||
    targetRevision <= baseRevision ||
    !isPlainObject(patch)
  ) {
    return {
      status: 'rejected_malformed',
      state: currentState,
      revision: currentRevision,
      reason:
        'Invalid base_revision, revision, or non-object patch payload in patch frame',
    }
  }

  // Cannot apply a delta when no base snapshot exists yet -> request resync
  if (currentState === null || currentRevision === null) {
    return {
      status: 'rejected_revision_gap',
      state: currentState as unknown as TState,
      revision: currentRevision ?? -1,
      expectedBaseRevision: null,
      receivedBaseRevision: baseRevision,
    }
  }

  // Duplicate or stale patch whose target revision is already <= currentRevision -> ignore idempotently
  if (targetRevision <= currentRevision) {
    return {
      status: 'ignored_stale_or_duplicate',
      state: currentState,
      revision: currentRevision,
    }
  }

  // Revision gap or base mismatch -> reject without mutating currentState and request resync
  if (baseRevision !== currentRevision) {
    return {
      status: 'rejected_revision_gap',
      state: currentState,
      revision: currentRevision,
      expectedBaseRevision: currentRevision,
      receivedBaseRevision: baseRevision,
    }
  }

  const nextState = mergePatchImmutable(currentState, patch) as TState
  return {
    status: 'applied',
    state: nextState,
    revision: targetRevision,
  }
}

/**
 * Recursively applies a field-level diff object (supporting nested keyed maps)
 * without mutating `base`.
 */
function mergePatchImmutable(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...base }
  for (const [key, patchVal] of Object.entries(patch)) {
    const existingVal = clone[key]
    if (isPlainObject(existingVal) && isPlainObject(patchVal)) {
      clone[key] = mergePatchImmutable(existingVal, patchVal)
    } else {
      clone[key] = patchVal
    }
  }
  return clone
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

export interface TopicDeltaCoordinatorOptions {
  /** Invoked when a patch fails base_revision validation and requires a full snapshot resync. */
  onResyncRequired?: (
    topic: string,
    expectedBaseRevision: number | null,
    receivedBaseRevision: number
  ) => void
}

interface TopicRevisionSlot<TState> {
  state: TState
  revision: number
  deltasEnabled: boolean
}

export class TopicDeltaStateCoordinator<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly slots = new Map<string, TopicRevisionSlot<TState>>()
  private readonly disabledDeltaTopics = new Set<string>()
  private readonly onResyncRequired?: TopicDeltaCoordinatorOptions['onResyncRequired']

  constructor(options: TopicDeltaCoordinatorOptions = {}) {
    this.onResyncRequired = options.onResyncRequired
  }

  /**
   * Configures whether a specific topic accepts delta patches or requires full snapshots.
   */
  setTopicDeltasEnabled(topic: string, enabled: boolean): void {
    const trimmed = topic.trim()
    if (enabled) {
      this.disabledDeltaTopics.delete(trimmed)
    } else {
      this.disabledDeltaTopics.add(trimmed)
    }
    const slot = this.slots.get(trimmed)
    if (slot) {
      slot.deltasEnabled = enabled
    }
  }

  /**
   * Processes either a full `snapshot` frame or a `patch` frame for `topic`.
   */
  processFrame(frame: RevisionedTopicFrame<TState>): PatchApplicationResult<TState> {
    const topic = frame.topic.trim()
    const slot = this.slots.get(topic)

    if (frame.type === 'snapshot') {
      if (
        typeof frame.revision !== 'number' ||
        !Number.isInteger(frame.revision) ||
        frame.revision < 0 ||
        !isPlainObject(frame.payload)
      ) {
        return {
          status: 'rejected_malformed',
          state: slot?.state ?? null,
          revision: slot?.revision ?? null,
          reason: 'Invalid snapshot revision or payload',
        }
      }

      if (slot && frame.revision < slot.revision) {
        return {
          status: 'ignored_stale_or_duplicate',
          state: slot.state,
          revision: slot.revision,
        }
      }

      const nextState = { ...frame.payload }
      this.slots.set(topic, {
        state: nextState,
        revision: frame.revision,
        deltasEnabled: !this.disabledDeltaTopics.has(topic),
      })

      return {
        status: 'applied',
        state: nextState,
        revision: frame.revision,
      }
    }

    // If topic opted out of deltas, trigger a full snapshot resync
    if (this.disabledDeltaTopics.has(topic)) {
      this.onResyncRequired?.(
        topic,
        slot?.revision ?? null,
        frame.base_revision
      )
      return {
        status: 'rejected_revision_gap',
        state: (slot?.state ?? null) as unknown as TState,
        revision: slot?.revision ?? -1,
        expectedBaseRevision: slot?.revision ?? null,
        receivedBaseRevision: frame.base_revision,
      }
    }

    const result = applyRevisionedPatch<TState>(
      slot?.state ?? null,
      slot?.revision ?? null,
      frame
    )

    if (result.status === 'applied') {
      this.slots.set(topic, {
        state: result.state,
        revision: result.revision,
        deltasEnabled: true,
      })
    } else if (result.status === 'rejected_revision_gap') {
      this.onResyncRequired?.(
        topic,
        result.expectedBaseRevision,
        result.receivedBaseRevision
      )
    }

    return result
  }

  getTopicState(topic: string): { state: TState; revision: number } | null {
    const slot = this.slots.get(topic.trim())
    if (!slot) return null
    return { state: slot.state, revision: slot.revision }
  }
}
