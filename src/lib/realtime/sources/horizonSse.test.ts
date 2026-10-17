import { describe, expect, it, vi } from 'vitest'
import {
  HorizonOperationsSseAdapter,
  resolveHorizonBaseUrl,
  type FakeEventSourceLike,
} from './horizonSse'

describe('HorizonOperationsSseAdapter', () => {
  it('resolves official Horizon URLs for testnet/mainnet/futurenet and rejects unknown networks', () => {
    expect(resolveHorizonBaseUrl('testnet')).toBe(
      'https://horizon-testnet.stellar.org',
    )
    expect(resolveHorizonBaseUrl('mainnet')).toBe('https://horizon.stellar.org')
    expect(resolveHorizonBaseUrl('futurenet')).toBe(
      'https://horizon-futurenet.stellar.org',
    )
    expect(() => resolveHorizonBaseUrl('unknown-chain')).toThrow(
      /Unsupported Stellar network/,
    )
  })

  it('hydrates from paged REST operations, appends SSE operations beyond cursor without duplicates, and resumes on reconnect', () => {
    vi.useFakeTimers()
    try {
      const createdSources: Array<FakeEventSourceLike & { closed: boolean }> = []
      const adapter = new HorizonOperationsSseAdapter({
        accountId: 'GUSER123',
        network: 'testnet',
        baseBackoffMs: 500,
        createEventSource: (url) => {
          const src = {
            url,
            onmessage: null,
            onerror: null,
            closed: false,
            close() {
              this.closed = true
            },
          }
          createdSources.push(src)
          return src
        },
      })

      // 1. Seed initial REST page
      adapter.seedRestOperations([
        {
          id: '1001',
          paging_token: '1001',
          type: 'payment',
          created_at: '2026-03-01T10:00:00Z',
          transaction_hash: 'tx-1001',
          source_account: 'GUSER123',
          amount: '250.0000000',
          asset_code: 'USDC',
          to: 'GPOOL',
        },
      ])
      expect(adapter.getCursor()).toBe('1001')

      // 2. Start SSE stream -> connects with cursor=1001
      adapter.start()
      expect(createdSources).toHaveLength(1)
      expect(createdSources[0].url).toContain(
        '/accounts/GUSER123/operations?cursor=1001&order=asc',
      )

      // Push duplicate operation 1001 -> ignored
      createdSources[0].onmessage?.({
        data: JSON.stringify({
          id: '1001',
          paging_token: '1001',
          type: 'payment',
          created_at: '2026-03-01T10:00:00Z',
          transaction_hash: 'tx-1001',
          source_account: 'GUSER123',
        }),
      })
      expect(adapter.getOperations()).toHaveLength(1)

      // Push newer operation 1002 -> prepended at top and advances cursor to 1002
      createdSources[0].onmessage?.({
        data: JSON.stringify({
          id: '1002',
          paging_token: '1002',
          type: 'invoke_host_function',
          created_at: '2026-03-01T10:01:00Z',
          transaction_hash: 'tx-1002',
          source_account: 'GUSER123',
          asset_type: 'native',
        }),
      })
      expect(adapter.getOperations().map((o) => o.id)).toEqual(['1002', '1001'])
      expect(adapter.getCursor()).toBe('1002')

      // 3. Horizon closes long-lived SSE stream -> adapter reconnects with cursor=1002
      createdSources[0].onerror?.(new Error('stream_closed_by_horizon'))
      expect(createdSources[0].closed).toBe(true)

      vi.advanceTimersByTime(500)
      expect(createdSources).toHaveLength(2)
      expect(createdSources[1].url).toContain('cursor=1002')

      // 4. Switch account/network -> closes old stream immediately and opens exactly one new stream
      adapter.switchScope('GUSER999', 'mainnet')
      expect(createdSources[1].closed).toBe(true)
      expect(createdSources[2].url).toContain(
        'https://horizon.stellar.org/accounts/GUSER999/operations?cursor=now&order=asc',
      )

      adapter.stop()
      expect(createdSources[2].closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
