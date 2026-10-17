/**
 * Pluggable realtime wire codec negotiation via WebSocket subprotocols (#259).
 *
 * Supports byte-identical JSON text frames (`refract.json.v1`) as the universal
 * default/fallback alongside a compact binary UTF-8 tuple/dictionary codec
 * (`refract.compact-bin.v1`) that reduces high-frequency oracle/pool frame size
 * while decoding into the exact same internal message representation.
 */

export const SUBPROTOCOL_JSON_V1 = 'refract.json.v1'
export const SUBPROTOCOL_COMPACT_BIN_V1 = 'refract.compact-bin.v1'

export type WirePayload = string | Uint8Array | ArrayBuffer

export interface RealtimeWireMessage<TPayload = unknown> {
  type: string
  topic?: string
  eventId?: string
  sequence?: number
  timestamp?: number
  payload?: TPayload
}

export interface RealtimeCodec {
  /** WebSocket `Sec-WebSocket-Protocol` identifier. */
  readonly subprotocol: string
  /** Whether the codec emits binary (`Uint8Array` / `ArrayBuffer`) frames. */
  readonly isBinary: boolean
  /** Encodes an internal message object into a wire frame. */
  encode<TPayload = unknown>(message: RealtimeWireMessage<TPayload>): WirePayload
  /** Decodes a wire frame into an internal message object. */
  decode<TPayload = unknown>(frame: WirePayload): RealtimeWireMessage<TPayload>
  /** Formats a wire frame into human-readable JSON for the dev message inspector. */
  inspect(frame: WirePayload): string
}

/**
 * Default JSON text codec (`refract.json.v1`).
 */
export class JsonRealtimeCodec implements RealtimeCodec {
  readonly subprotocol = SUBPROTOCOL_JSON_V1
  readonly isBinary = false
  private readonly textDecoder = new TextDecoder()

  encode<TPayload = unknown>(message: RealtimeWireMessage<TPayload>): string {
    return JSON.stringify(message)
  }

  decode<TPayload = unknown>(frame: WirePayload): RealtimeWireMessage<TPayload> {
    const text = this.toText(frame)
    const parsed = JSON.parse(text) as RealtimeWireMessage<TPayload>
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') {
      throw new Error('Invalid JSON realtime message envelope')
    }
    return parsed
  }

  inspect(frame: WirePayload): string {
    try {
      const decoded = this.decode(frame)
      return JSON.stringify(decoded)
    } catch {
      return this.toText(frame)
    }
  }

  private toText(frame: WirePayload): string {
    if (typeof frame === 'string') return frame
    if (frame instanceof ArrayBuffer) {
      return this.textDecoder.decode(new Uint8Array(frame))
    }
    return this.textDecoder.decode(frame)
  }
}

interface CompactEnvelopeTuple<TPayload = unknown> {
  /** 0: type, 1: topic, 2: eventId, 3: sequence, 4: timestamp, 5: payload */
  0: string
  1?: string | null
  2?: string | null
  3?: number | null
  4?: number | null
  5?: TPayload
}

/**
 * Compact binary codec (`refract.compact-bin.v1`) that strips verbose envelope
 * property names into a positional array tuple and encodes as a binary `Uint8Array`.
 */
export class CompactBinaryRealtimeCodec implements RealtimeCodec {
  readonly subprotocol = SUBPROTOCOL_COMPACT_BIN_V1
  readonly isBinary = true
  private readonly textEncoder = new TextEncoder()
  private readonly textDecoder = new TextDecoder()

  encode<TPayload = unknown>(message: RealtimeWireMessage<TPayload>): Uint8Array {
    const tuple: CompactEnvelopeTuple<TPayload> = [
      message.type,
      message.topic ?? null,
      message.eventId ?? null,
      message.sequence ?? null,
      message.timestamp ?? null,
      message.payload,
    ]
    return this.textEncoder.encode(JSON.stringify(tuple))
  }

  decode<TPayload = unknown>(frame: WirePayload): RealtimeWireMessage<TPayload> {
    const rawText =
      typeof frame === 'string'
        ? frame
        : frame instanceof ArrayBuffer
          ? this.textDecoder.decode(new Uint8Array(frame))
          : this.textDecoder.decode(frame)

    const parsed = JSON.parse(rawText) as unknown
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') {
      throw new Error('Invalid compact binary realtime frame')
    }

    const result: RealtimeWireMessage<TPayload> = {
      type: parsed[0],
    }
    if (typeof parsed[1] === 'string') result.topic = parsed[1]
    if (typeof parsed[2] === 'string') result.eventId = parsed[2]
    if (typeof parsed[3] === 'number') result.sequence = parsed[3]
    if (typeof parsed[4] === 'number') result.timestamp = parsed[4]
    if (parsed[5] !== undefined) result.payload = parsed[5] as TPayload

    return result
  }

  inspect(frame: WirePayload): string {
    const decoded = this.decode(frame)
    return JSON.stringify(decoded)
  }
}

export interface CodecNegotiatorOptions {
  /** Whether to prefer the compact binary codec ahead of JSON during handshake (default: false). */
  preferCompact?: boolean
  /** Optional custom codecs registered in addition to the built-in JSON and compact binary codecs. */
  customCodecs?: RealtimeCodec[]
}

export class RealtimeCodecNegotiator {
  private readonly jsonCodec = new JsonRealtimeCodec()
  private readonly compactCodec = new CompactBinaryRealtimeCodec()
  private readonly codecBySubprotocol = new Map<string, RealtimeCodec>()
  private readonly preferCompact: boolean

  constructor(options: CodecNegotiatorOptions = {}) {
    this.preferCompact = options.preferCompact ?? false
    this.codecBySubprotocol.set(this.jsonCodec.subprotocol, this.jsonCodec)
    this.codecBySubprotocol.set(this.compactCodec.subprotocol, this.compactCodec)

    if (options.customCodecs) {
      for (const codec of options.customCodecs) {
        this.codecBySubprotocol.set(codec.subprotocol, codec)
      }
    }
  }

  /**
   * Returns the ordered list of WebSocket subprotocols to advertise in
   * `new WebSocket(url, subprotocols)`.
   */
  getClientSubprotocols(): string[] {
    if (this.preferCompact) {
      return [SUBPROTOCOL_COMPACT_BIN_V1, SUBPROTOCOL_JSON_V1]
    }
    return [SUBPROTOCOL_JSON_V1, SUBPROTOCOL_COMPACT_BIN_V1]
  }

  /**
   * Resolves the active `RealtimeCodec` based on the server's selected
   * `WebSocket.protocol` header. Fails closed to `JsonRealtimeCodec` if the
   * server selects nothing or an unrecognized subprotocol.
   */
  resolveNegotiatedCodec(serverSelectedSubprotocol?: string | null): RealtimeCodec {
    if (!serverSelectedSubprotocol) {
      return this.jsonCodec
    }
    const trimmed = serverSelectedSubprotocol.trim()
    return this.codecBySubprotocol.get(trimmed) ?? this.jsonCodec
  }
}
