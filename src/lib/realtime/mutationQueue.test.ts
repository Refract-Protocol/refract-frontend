import { describe, expect, it } from 'vitest'
import {
  OutboundMutationQueue,
  type QueuedMutationAction,
} from './mutationQueue'

describe('OutboundMutationQueue (#271)', () => {
  it('replays auth before topic mutations, collapses repeated toggles, and avoids double-subscribing resynced topics', () => {
    const queue = new OutboundMutationQueue()

    // While disconnected: user toggles 'oracle:XLM/USD', subscribes 'claims:GABC', unsubscribes 'pool:main', and authenticates
    queue.enqueueSubscribe('oracle:XLM/USD', 'cur-1')
    queue.enqueueUnsubscribe('oracle:XLM/USD')
    queue.enqueueSubscribe('oracle:XLM/USD', 'cur-2') // collapses to final subscribe with 'cur-2'

    queue.enqueueSubscribe('claims:GABC') // will be marked already resynced on server
    queue.enqueueUnsubscribe('pool:main') // was active on server before/after resync -> should unsubscribe
    queue.enqueueUnsubscribe('notifications:GABC') // not active on server -> redundant unsubscribe skipped
    queue.enqueueAuth('jwt-token-xyz', 'GABC')

    const sent: QueuedMutationAction[] = []
    const replayed = queue.replayOnReconnect(
      (mutation) => {
        sent.push(mutation)
      },
      ['claims:GABC', 'pool:main']
    )

    expect(replayed).toEqual([
      { kind: 'auth', token: 'jwt-token-xyz', scope: 'GABC' },
      { kind: 'subscribe', topic: 'oracle:XLM/USD', cursor: 'cur-2' },
      { kind: 'unsubscribe', topic: 'pool:main' },
    ])
    expect(sent).toEqual(replayed)
    expect(queue.getPendingCount()).toBe(0)
  })

  it('bounds queue capacity with visible overflow diagnostics and discards all state on logout', () => {
    const overflows: string[] = []
    const queue = new OutboundMutationQueue({
      maxCapacity: 2,
      onOverflow: (diag) => overflows.push(diag.droppedTopic),
    })

    queue.enqueueSubscribe('topic:1')
    queue.enqueueSubscribe('topic:2')
    queue.enqueueSubscribe('topic:3') // overflows capacity=2 -> drops 'topic:1'

    expect(overflows).toEqual(['topic:1'])
    expect(queue.getOverflowHistory()).toHaveLength(1)

    // Explicit logout / teardown clears everything
    queue.enqueueAuth('tok-1')
    queue.discardAll()
    expect(queue.getPendingCount()).toBe(0)

    const replayedAfterLogout = queue.replayOnReconnect(() => true)
    expect(replayedAfterLogout).toEqual([])
  })

  it('halts replay without looping if the socket fails mid-flush and retains unsent mutations', () => {
    const queue = new OutboundMutationQueue()
    queue.enqueueSubscribe('topic:a')
    queue.enqueueSubscribe('topic:b')

    let attempts = 0
    const firstPass = queue.replayOnReconnect(() => {
      attempts += 1
      // First item ('topic:a') succeeds, second item ('topic:b') fails due to socket drop
      return attempts === 1
    })

    expect(firstPass).toEqual([
      { kind: 'subscribe', topic: 'topic:a', cursor: undefined },
    ])
    expect(queue.getPendingCount()).toBe(1)

    // Next reconnect replays only the remaining 'topic:b'
    const secondPass = queue.replayOnReconnect(() => true)
    expect(secondPass).toEqual([
      { kind: 'subscribe', topic: 'topic:b', cursor: undefined },
    ])
    expect(queue.getPendingCount()).toBe(0)
  })
})
