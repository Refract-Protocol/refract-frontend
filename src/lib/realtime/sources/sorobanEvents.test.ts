import { describe, expect, it, vi } from 'vitest'
import {
  createInMemorySorobanCheckpointStore,
  SorobanEventsAdapter,
  type NormalizedSorobanRealtimeEvent,
} from './sorobanEvents'

function makeJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response
}

describe('SorobanEventsAdapter', () => {
  it('acts as a clean no-op when contract IDs are unconfigured', async () => {
    const fetchSpy = vi.fn()
    const adapter = new SorobanEventsAdapter({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      policyContractId: '',
      poolContractId: '   ',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    expect(adapter.isEnabled()).toBe(false)
    const events = await adapter.pollOnce()
    expect(events).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('bootstraps from getLatestLedger, normalizes contract events, deduplicates IDs, and advances pagingToken', async () => {
    const rpcCalls: Array<{ method: string; params: Record<string, unknown> }> = []
    const store = createInMemorySorobanCheckpointStore()

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      rpcCalls.push({ method: body.method, params: body.params })

      if (body.method === 'getLatestLedger') {
        return makeJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { id: 'ledger-hash-500', protocolVersion: 20, sequence: 500 },
        })
      }

      if (body.method === 'getEvents') {
        if (!body.params.pagination?.cursor) {
          return makeJsonResponse({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              latestLedger: 502,
              oldestLedger: 400,
              events: [
                {
                  id: '0000501-0001',
                  type: 'contract',
                  ledger: 501,
                  ledgerClosedAt: '2026-03-01T10:00:00Z',
                  contractId: 'CPOLICY123',
                  pagingToken: 'cursor-501-1',
                  topic: ['claim_approved', 'claim-77'],
                  value: { amount: '2500', claimant: 'GABC' },
                  txHash: 'tx-1',
                },
                {
                  id: '0000502-0001',
                  type: 'contract',
                  ledger: 502,
                  ledgerClosedAt: '2026-03-01T10:00:05Z',
                  contractId: 'CPOOL999',
                  pagingToken: 'cursor-502-1',
                  topic: ['liquidity_deposited'],
                  value: { totalLiquidity: '900000' },
                  txHash: 'tx-2',
                },
              ],
            },
          })
        }

        // Second poll with cursor returns one duplicate and one new event
        return makeJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            latestLedger: 503,
            oldestLedger: 400,
            events: [
              {
                id: '0000502-0001', // duplicate
                type: 'contract',
                ledger: 502,
                ledgerClosedAt: '2026-03-01T10:00:05Z',
                contractId: 'CPOOL999',
                pagingToken: 'cursor-502-1',
                topic: ['liquidity_deposited'],
                value: { totalLiquidity: '900000' },
              },
              {
                id: '0000503-0002',
                type: 'contract',
                ledger: 503,
                ledgerClosedAt: '2026-03-01T10:00:10Z',
                contractId: 'CPOLICY123',
                pagingToken: 'cursor-503-2',
                topic: ['policy_minted', 'pol-9'],
                value: { coverage: '10000' },
              },
            ],
          },
        })
      }

      throw new Error(`Unexpected method ${body.method}`)
    })

    const received: NormalizedSorobanRealtimeEvent[] = []
    const adapter = new SorobanEventsAdapter({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      policyContractId: 'CPOLICY123',
      poolContractId: 'CPOOL999',
      checkpointStore: store,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onEvent: (ev) => received.push(ev),
    })

    const firstBatch = await adapter.pollOnce()
    expect(firstBatch).toHaveLength(2)
    expect(firstBatch[0].topic).toBe('claims:claim_approved:claim-77')
    expect(firstBatch[1].topic).toBe('pool:liquidity_deposited')

    const saved = store.get(adapter.getCheckpointKey())
    expect(saved?.pagingToken).toBe('cursor-502-1')
    expect(saved?.lastLedger).toBe(502)

    const secondBatch = await adapter.pollOnce()
    expect(secondBatch).toHaveLength(1)
    expect(secondBatch[0].eventId).toBe('0000503-0002')
    expect(secondBatch[0].topic).toBe('policies:policy_minted:pol-9')
    expect(received).toHaveLength(3)
  })

  it('detects ledger retention-window gap and triggers onRetentionGap callback', async () => {
    const store = createInMemorySorobanCheckpointStore()
    const gaps: Array<{
      requestedStartLedger: number
      oldestLedger: number
      latestLedger: number
    }> = []

    const adapter = new SorobanEventsAdapter({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      policyContractId: 'CPOLICY123',
      checkpointStore: store,
      onRetentionGap: (gap) => {
        gaps.push(gap)
      },
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body))
        if (body.method === 'getEvents') {
          return makeJsonResponse({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              latestLedger: 2000,
              oldestLedger: 1500,
              events: [],
            },
          })
        }
        throw new Error(`Unexpected ${body.method}`)
      }) as unknown as typeof fetch,
    })

    // Seed stale checkpoint at ledger 900 (< oldestLedger 1500)
    store.set(adapter.getCheckpointKey(), {
      lastLedger: 900,
      updatedAt: 1000,
    })

    await adapter.pollOnce()
    expect(gaps).toEqual([
      {
        requestedStartLedger: 900,
        oldestLedger: 1500,
        latestLedger: 2000,
      },
    ])
    expect(store.get(adapter.getCheckpointKey())?.lastLedger).toBe(2000)
  })

  it('computes exponential backoff with jitter and surfaces HTTP 429 rate-limit errors', async () => {
    const errors: Array<{ message: string; backoffMs: number }> = []
    const adapter = new SorobanEventsAdapter({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      policyContractId: 'CPOLICY123',
      baseBackoffMs: 1_000,
      maxBackoffMs: 16_000,
      random: () => 0.5, // jitterFactor = 0.75 + 0.25 = 1.0
      onError: (err, delay) => errors.push({ message: err.message, backoffMs: delay }),
      fetchImpl: (async () => makeJsonResponse({}, 429)) as unknown as typeof fetch,
    })

    expect(adapter.computeBackoffDelayMs(1)).toBe(1_000)
    expect(adapter.computeBackoffDelayMs(2)).toBe(2_000)
    expect(adapter.computeBackoffDelayMs(3)).toBe(4_000)
    await expect(adapter.pollOnce()).rejects.toThrow(/Soroban RPC HTTP 429/)
  })
})
