import { describe, expect, it } from 'vitest'
import {
  OutboundMessageBatcher,
  type OutboundWireFrame,
} from './outboundBatcher'

describe('OutboundMessageBatcher (#265)', () => {
  it('coalesces a 20-topic mount storm into a single batched frame preserving first-requested order', async () => {
    const sentFrames: OutboundWireFrame[] = []
    const batcher = new OutboundMessageBatcher({
      sendFrame: (frame) => {
        sentFrames.push(frame)
      },
    })

    const expectedTopics: string[] = []
    for (let i = 1; i <= 20; i++) {
      const topic = `oracle:ASSET_${i}/USD`
      expectedTopics.push(topic)
      batcher.queueSubscribe(topic)
    }

    // Wait for microtask flush
    await Promise.resolve()

    expect(sentFrames).toHaveLength(1)
    expect(sentFrames[0]).toEqual({
      type: 'batch_control',
      subscribe: expectedTopics,
      unsubscribe: [],
    })
  })

  it('elides net-zero subscribe+unsubscribe pairs in the same tick and respects auth boundaries', () => {
    const sentFrames: OutboundWireFrame[] = []
    const batcher = new OutboundMessageBatcher({
      sendFrame: (frame) => {
        sentFrames.push(frame)
      },
    })

    // Subscribe then immediately unsubscribe 'oracle:XLM/USD' in the same tick -> net-zero elided
    batcher.queueSubscribe('oracle:XLM/USD')
    batcher.queueUnsubscribe('oracle:XLM/USD')

    // Subscribe 'pool:main', then send an immediate auth control message
    batcher.queueSubscribe('pool:main')
    batcher.sendImmediate({ type: 'auth', token: 'jwt-123' })

    // Queue another topic after the auth boundary
    batcher.queueSubscribe('claims:GABC')
    batcher.flush()

    // 'oracle:XLM/USD' was completely elided; 'pool:main' flushed before 'auth'; 'claims:GABC' flushed after
    expect(sentFrames).toEqual([
      {
        type: 'batch_control',
        subscribe: ['pool:main'],
        unsubscribe: [],
      },
      {
        type: 'auth',
        token: 'jwt-123',
      },
      {
        type: 'batch_control',
        subscribe: ['claims:GABC'],
        unsubscribe: [],
      },
    ])
  })

  it('caps pending queue size with overflow warnings, retains batch on failed socket write, and flushes on reconnect', () => {
    const warnings: string[] = []
    const sentFrames: OutboundWireFrame[] = []
    let socketOpen = false

    const batcher = new OutboundMessageBatcher({
      maxQueueSize: 3,
      onOverflowWarning: (dropped) => warnings.push(dropped),
      sendFrame: (frame) => {
        if (!socketOpen) return false
        sentFrames.push(frame)
        return true
      },
    })

    batcher.queueSubscribe('topic:1')
    batcher.queueSubscribe('topic:2')
    batcher.queueSubscribe('topic:3')
    batcher.queueSubscribe('topic:4') // overflows maxQueueSize=3 -> drops 'topic:1'

    expect(warnings).toEqual(['topic:1'])
    expect(batcher.getDroppedOverflowCount()).toBe(1)

    // Attempt flush while socket is closed -> returns null and retains pending topics
    expect(batcher.flush()).toBeNull()
    expect(batcher.getPendingCount()).toBe(3)

    // Socket reconnects -> flushOnReconnect delivers all retained subscriptions in 1 frame
    socketOpen = true
    const reconnectFrame = batcher.flushOnReconnect()
    expect(reconnectFrame).toEqual({
      type: 'batch_control',
      subscribe: ['topic:2', 'topic:3', 'topic:4'],
      unsubscribe: [],
    })
    expect(sentFrames).toHaveLength(1)
  })
})
