import { describe, expect, it } from 'vitest'
import {
  CompactBinaryRealtimeCodec,
  JsonRealtimeCodec,
  RealtimeCodecNegotiator,
  SUBPROTOCOL_COMPACT_BIN_V1,
  SUBPROTOCOL_JSON_V1,
  type RealtimeWireMessage,
} from './codec'

describe('RealtimeCodecNegotiator & codecs (#259)', () => {
  it('orders subprotocols according to preference and fails closed to JSON on unknown or empty server selection', () => {
    const defaultNegotiator = new RealtimeCodecNegotiator()
    expect(defaultNegotiator.getClientSubprotocols()).toEqual([
      SUBPROTOCOL_JSON_V1,
      SUBPROTOCOL_COMPACT_BIN_V1,
    ])

    const compactPreferred = new RealtimeCodecNegotiator({ preferCompact: true })
    expect(compactPreferred.getClientSubprotocols()).toEqual([
      SUBPROTOCOL_COMPACT_BIN_V1,
      SUBPROTOCOL_JSON_V1,
    ])

    // Server selects JSON
    const pickedJson = compactPreferred.resolveNegotiatedCodec(SUBPROTOCOL_JSON_V1)
    expect(pickedJson.subprotocol).toBe(SUBPROTOCOL_JSON_V1)
    expect(pickedJson.isBinary).toBe(false)

    // Server selects compact binary
    const pickedCompact = compactPreferred.resolveNegotiatedCodec(
      SUBPROTOCOL_COMPACT_BIN_V1
    )
    expect(pickedCompact.subprotocol).toBe(SUBPROTOCOL_COMPACT_BIN_V1)
    expect(pickedCompact.isBinary).toBe(true)

    // Server selects nothing or unknown subprotocol -> fails closed to JSON without throwing
    expect(compactPreferred.resolveNegotiatedCodec('').subprotocol).toBe(
      SUBPROTOCOL_JSON_V1
    )
    expect(compactPreferred.resolveNegotiatedCodec(null).subprotocol).toBe(
      SUBPROTOCOL_JSON_V1
    )
    expect(
      compactPreferred.resolveNegotiatedCodec('refract.unknown.v99').subprotocol
    ).toBe(SUBPROTOCOL_JSON_V1)
  })

  it('guarantees round-trip encode/decode parity and smaller wire size for CompactBinaryRealtimeCodec', () => {
    const jsonCodec = new JsonRealtimeCodec()
    const compactCodec = new CompactBinaryRealtimeCodec()

    const sampleMessage: RealtimeWireMessage<{
      pair: string
      price: string
      confidence: number
    }> = {
      type: 'event',
      topic: 'oracle:XLM/USD',
      eventId: 'evt-7788',
      sequence: 109,
      timestamp: 1_700_000_000_000,
      payload: {
        pair: 'XLM/USD',
        price: '0.1289000',
        confidence: 0.999,
      },
    }

    const jsonWire = jsonCodec.encode(sampleMessage)
    const compactWire = compactCodec.encode(sampleMessage)

    expect(typeof jsonWire).toBe('string')
    expect(compactWire).toBeInstanceOf(Uint8Array)
    expect(compactWire.byteLength).toBeLessThan(jsonWire.length)

    const decodedFromJson = jsonCodec.decode(jsonWire)
    const decodedFromCompact = compactCodec.decode(compactWire)
    const decodedFromArrayBuffer = compactCodec.decode(compactWire.buffer)

    expect(decodedFromCompact).toEqual(decodedFromJson)
    expect(decodedFromArrayBuffer).toEqual(sampleMessage)

    // Dev inspector renders identical human-readable JSON for both codecs
    expect(JSON.parse(compactCodec.inspect(compactWire))).toEqual(
      JSON.parse(jsonCodec.inspect(jsonWire))
    )
  })
})
