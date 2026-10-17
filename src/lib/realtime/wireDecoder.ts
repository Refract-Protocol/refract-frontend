export type WireDecodeErrorCode =
  | 'empty_frame'
  | 'binary_frame_unsupported'
  | 'frame_too_large'
  | 'max_depth_exceeded'
  | 'malformed_json'
  | 'prototype_pollution_attempt'
  | 'invalid_envelope'
  | 'invalid_topic'
  | 'invalid_sequence'

export interface WireDecodeError {
  code: WireDecodeErrorCode
  message: string
  frameByteLength: number
  shouldCloseSocket: boolean
}

export interface ValidatedWireFrame<T = unknown> {
  topic: string
  payload: T
  sequence?: number
  timestamp?: number
  eventId?: string
}

export type WireDecodeResult<T = unknown> =
  | { ok: true; frame: ValidatedWireFrame<T> }
  | { ok: false; error: WireDecodeError }

export interface WireDecoderOptions {
  /** Maximum frame size in UTF-8 bytes before rejection (default: 65536) */
  maxFrameBytes?: number
  /** Maximum JSON object/array nesting depth (default: 16) */
  maxNestingDepth?: number
  /** Maximum topic string length (default: 128) */
  maxTopicLength?: number
  /** Whether UTF-8 ArrayBuffer/Uint8Array frames are accepted (default: false) */
  allowBinaryFrames?: boolean
}

const TOPIC_SAFE_PATTERN = /^[a-zA-Z0-9_:.-]{1,128}$/
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function measureJsonNestingDepth(rawJson: string, maxDepth: number): number {
  let depth = 0
  let maxObserved = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < rawJson.length; i += 1) {
    const ch = rawJson.charCodeAt(i)
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === 0x5c /* \ */ && inString) {
      escaped = true
      continue
    }
    if (ch === 0x22 /* " */) {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === 0x7b /* { */ || ch === 0x5b /* [ */) {
      depth += 1
      if (depth > maxObserved) {
        maxObserved = depth
        if (maxObserved > maxDepth) {
          return maxObserved
        }
      }
    } else if (ch === 0x7d /* } */ || ch === 0x5d /* ] */) {
      depth = Math.max(0, depth - 1)
    }
  }

  return maxObserved
}

function containsDangerousKeyInTree(value: unknown, depth = 0, maxDepth = 16): boolean {
  if (depth > maxDepth) return true
  if (value === null || typeof value !== 'object') return false

  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsDangerousKeyInTree(item, depth + 1, maxDepth)) {
        return true
      }
    }
    return false
  }

  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) {
      return true
    }
    if (containsDangerousKeyInTree(record[key], depth + 1, maxDepth)) {
      return true
    }
  }

  return false
}

/**
 * Pure, exception-free realtime wire frame decoder with strict size, nesting depth,
 * prototype-pollution, and topic-format guards.
 */
export function decodeRealtimeWireFrame<T = unknown>(
  rawInput: unknown,
  options: WireDecoderOptions = {},
): WireDecodeResult<T> {
  const maxFrameBytes = options.maxFrameBytes ?? 65_536
  const maxNestingDepth = options.maxNestingDepth ?? 16
  const maxTopicLength = options.maxTopicLength ?? 128

  let textFrame: string
  let byteLength = 0

  if (typeof rawInput === 'string') {
    textFrame = rawInput
    byteLength =
      typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(rawInput).byteLength
        : rawInput.length
  } else if (
    rawInput instanceof ArrayBuffer ||
    ArrayBuffer.isView(rawInput)
  ) {
    const view =
      rawInput instanceof ArrayBuffer
        ? new Uint8Array(rawInput)
        : new Uint8Array(rawInput.buffer, rawInput.byteOffset, rawInput.byteLength)
    byteLength = view.byteLength

    if (!options.allowBinaryFrames) {
      return {
        ok: false,
        error: {
          code: 'binary_frame_unsupported',
          message: 'Binary frames are not supported on text realtime transport',
          frameByteLength: byteLength,
          shouldCloseSocket: true,
        },
      }
    }

    if (byteLength > maxFrameBytes) {
      return {
        ok: false,
        error: {
          code: 'frame_too_large',
          message: `Frame size ${byteLength} exceeds maxFrameBytes ${maxFrameBytes}`,
          frameByteLength: byteLength,
          shouldCloseSocket: true,
        },
      }
    }

    textFrame = new TextDecoder('utf-8', { fatal: false }).decode(view)
  } else {
    return {
      ok: false,
      error: {
        code: 'invalid_envelope',
        message: 'Realtime frame input must be a string or binary buffer',
        frameByteLength: 0,
        shouldCloseSocket: false,
      },
    }
  }

  if (byteLength > maxFrameBytes) {
    return {
      ok: false,
      error: {
        code: 'frame_too_large',
        message: `Frame size ${byteLength} exceeds maxFrameBytes ${maxFrameBytes}`,
        frameByteLength: byteLength,
        shouldCloseSocket: true,
      },
    }
  }

  const trimmed = textFrame.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: {
        code: 'empty_frame',
        message: 'Wire frame is empty',
        frameByteLength: byteLength,
        shouldCloseSocket: false,
      },
    }
  }

  const observedDepth = measureJsonNestingDepth(trimmed, maxNestingDepth)
  if (observedDepth > maxNestingDepth) {
    return {
      ok: false,
      error: {
        code: 'max_depth_exceeded',
        message: `JSON nesting depth exceeds maximum allowed depth of ${maxNestingDepth}`,
        frameByteLength: byteLength,
        shouldCloseSocket: true,
      },
    }
  }

  let dangerDetected = false
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed, (key, val) => {
      if (DANGEROUS_KEYS.has(key)) {
        dangerDetected = true
        return undefined
      }
      return val
    })
  } catch {
    return {
      ok: false,
      error: {
        code: 'malformed_json',
        message: 'Wire frame is not valid JSON',
        frameByteLength: byteLength,
        shouldCloseSocket: false,
      },
    }
  }

  if (
    dangerDetected ||
    containsDangerousKeyInTree(parsed, 0, maxNestingDepth)
  ) {
    return {
      ok: false,
      error: {
        code: 'prototype_pollution_attempt',
        message: 'Rejected hostile prototype-pollution key in wire frame',
        frameByteLength: byteLength,
        shouldCloseSocket: true,
      },
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: {
        code: 'invalid_envelope',
        message: 'Top-level wire frame must be a JSON object',
        frameByteLength: byteLength,
        shouldCloseSocket: false,
      },
    }
  }

  const obj = parsed as Record<string, unknown>
  const rawTopic = obj.topic
  if (
    typeof rawTopic !== 'string' ||
    rawTopic.length === 0 ||
    rawTopic.length > maxTopicLength ||
    !TOPIC_SAFE_PATTERN.test(rawTopic)
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid_topic',
        message: 'Wire frame contains missing or invalid topic identifier',
        frameByteLength: byteLength,
        shouldCloseSocket: false,
      },
    }
  }

  if (!('payload' in obj)) {
    return {
      ok: false,
      error: {
        code: 'invalid_envelope',
        message: 'Wire frame is missing required payload field',
        frameByteLength: byteLength,
        shouldCloseSocket: false,
      },
    }
  }

  if (obj.sequence !== undefined) {
    if (
      typeof obj.sequence !== 'number' ||
      !Number.isSafeInteger(obj.sequence) ||
      obj.sequence < 0
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_sequence',
          message: 'Wire frame sequence must be a non-negative safe integer',
          frameByteLength: byteLength,
          shouldCloseSocket: false,
        },
      }
    }
  }

  const timestamp =
    typeof obj.timestamp === 'number' && Number.isFinite(obj.timestamp)
      ? obj.timestamp
      : undefined

  const eventId =
    typeof obj.eventId === 'string' && obj.eventId.length <= 128
      ? obj.eventId
      : undefined

  return {
    ok: true,
    frame: {
      topic: rawTopic,
      payload: obj.payload as T,
      ...(obj.sequence !== undefined ? { sequence: obj.sequence as number } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
      ...(eventId !== undefined ? { eventId } : {}),
    },
  }
}
