import { describe, expect, it } from 'vitest'
import { decodeRealtimeWireFrame } from '../wireDecoder'

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HOSTILE_CORPUS: ReadonlyArray<{
  name: string
  input: unknown
  expectedCode: string
}> = [
  {
    name: 'empty string',
    input: '   ',
    expectedCode: 'empty_frame',
  },
  {
    name: 'truncated JSON object',
    input: '{"topic":"oracle_update","payload":{"price":1.0',
    expectedCode: 'malformed_json',
  },
  {
    name: 'top-level JSON array instead of object',
    input: '[{"topic":"oracle_update","payload":1}]',
    expectedCode: 'invalid_envelope',
  },
  {
    name: 'prototype pollution via __proto__',
    input: '{"topic":"oracle_update","payload":{"__proto__":{"polluted":true}}}',
    expectedCode: 'prototype_pollution_attempt',
  },
  {
    name: 'prototype pollution via constructor.prototype',
    input: '{"topic":"oracle_update","payload":{"constructor":{"prototype":{"isAdmin":true}}}}',
    expectedCode: 'prototype_pollution_attempt',
  },
  {
    name: 'topic with control characters / injection',
    input: '{"topic":"claims:0x1\\n\\r<script>","payload":{}}',
    expectedCode: 'invalid_topic',
  },
  {
    name: 'negative sequence number',
    input: '{"topic":"claims:0x1","payload":{},"sequence":-5}',
    expectedCode: 'invalid_sequence',
  },
  {
    name: 'binary Uint8Array frame on text transport',
    input: new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x7d]),
    expectedCode: 'binary_frame_unsupported',
  },
]

describe('Realtime Wire Decoder Fuzz & Hostile Payload Suite', () => {
  it('rejects every entry in the checked-in hostile corpus with a typed error and zero Object.prototype mutation', () => {
    for (const entry of HOSTILE_CORPUS) {
      const res = decodeRealtimeWireFrame(entry.input)
      expect(res.ok, `Expected failure for corpus case: ${entry.name}`).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe(entry.expectedCode)
      }
      expect(
        (Object.prototype as Record<string, unknown>).polluted,
      ).toBeUndefined()
      expect(
        (Object.prototype as Record<string, unknown>).isAdmin,
      ).toBeUndefined()
    }
  })

  it('enforces maxFrameBytes and maxNestingDepth before full evaluation', () => {
    const oversized = JSON.stringify({
      topic: 'oracle_update',
      payload: { blob: 'x'.repeat(10_000) },
    })
    const sizeRes = decodeRealtimeWireFrame(oversized, { maxFrameBytes: 4_096 })
    expect(sizeRes).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'frame_too_large',
        shouldCloseSocket: true,
      }),
    })

    let deepJson = '"leaf"'
    for (let i = 0; i < 30; i += 1) {
      deepJson = `{"a":${deepJson}}`
    }
    const frameWithDeepPayload = `{"topic":"oracle_update","payload":${deepJson}}`
    const depthRes = decodeRealtimeWireFrame(frameWithDeepPayload, {
      maxNestingDepth: 12,
    })
    expect(depthRes).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'max_depth_exceeded',
        shouldCloseSocket: true,
      }),
    })
  })

  it('survives 300 seeded property-based fuzz mutations without throwing or mutating Object.prototype', () => {
    const rand = createMulberry32(0xdec0de42)
    const alphabet = '{}[]":,0123456789abcdefghijklmnopqrstuvwxyz_-\n\0\\/'

    for (let i = 0; i < 300; i += 1) {
      const mode = i % 4
      let candidate: unknown

      if (mode === 0) {
        // Random raw string
        const len = Math.floor(rand() * 250)
        let s = ''
        for (let j = 0; j < len; j += 1) {
          s += alphabet[Math.floor(rand() * alphabet.length)]
        }
        candidate = s
      } else if (mode === 1) {
        // Structurally valid envelope with extreme numeric/string values
        candidate = JSON.stringify({
          topic: rand() > 0.2 ? `claims:item_${i}` : '',
          payload: {
            amount: String(Math.floor(rand() * Number.MAX_SAFE_INTEGER)),
            extraUnknownField: i,
            nested: [i, null, true, false],
          },
          sequence: rand() > 0.15 ? i : -1,
          timestamp: 1_700_000_000_000 + i,
        })
      } else if (mode === 2) {
        // Mutated / sliced valid JSON frame
        const valid = JSON.stringify({
          topic: 'pool:liquidity',
          payload: { tvl: 100000, apy: 5.5 },
          sequence: i,
        })
        const cut = Math.floor(rand() * valid.length)
        candidate = valid.slice(0, cut)
      } else {
        // Random non-string / binary buffer
        candidate =
          rand() > 0.5
            ? new Uint8Array([i & 0xff, (i >> 8) & 0xff])
            : { notAFrame: true }
      }

      const start = performance.now()
      const result = decodeRealtimeWireFrame(candidate, {
        maxFrameBytes: 8_192,
        maxNestingDepth: 10,
      })
      const elapsedMs = performance.now() - start

      expect(elapsedMs).toBeLessThan(50)
      expect(typeof result.ok).toBe('boolean')
      if (result.ok) {
        expect(typeof result.frame.topic).toBe('string')
        expect(result.frame.topic.length).toBeGreaterThan(0)
      } else {
        expect(typeof result.error.code).toBe('string')
      }
      expect(Object.keys(Object.prototype)).toEqual([])
    }
  })
})
