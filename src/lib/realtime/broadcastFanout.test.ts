import { describe, expect, it } from 'vitest'
import {
  BroadcastChannelFanoutNode,
  type BroadcastChannelLike,
  type FanoutConnectionState,
} from './broadcastFanout'

class FakeBroadcastHub {
  private readonly peers = new Map<string, Set<FakeBroadcastChannel>>()

  createChannel(name: string): BroadcastChannelLike {
    const channel = new FakeBroadcastChannel(name, this)
    let group = this.peers.get(name)
    if (!group) {
      group = new Set()
      this.peers.set(name, group)
    }
    group.add(channel)
    return channel
  }

  broadcast(sender: FakeBroadcastChannel, message: unknown): void {
    const group = this.peers.get(sender.name)
    if (!group) return
    for (const peer of Array.from(group)) {
      if (peer !== sender && peer.onmessage) {
        peer.onmessage({ data: message })
      }
    }
  }

  remove(channel: FakeBroadcastChannel): void {
    this.peers.get(channel.name)?.delete(channel)
  }
}

class FakeBroadcastChannel implements BroadcastChannelLike {
  readonly name: string
  onmessage: ((event: { data: unknown }) => void) | null = null
  private readonly hub: FakeBroadcastHub

  constructor(name: string, hub: FakeBroadcastHub) {
    this.name = name
    this.hub = hub
  }

  postMessage(message: unknown): void {
    this.hub.broadcast(this, message)
  }

  close(): void {
    this.hub.remove(this)
  }
}

describe('BroadcastChannelFanoutNode (#266)', () => {
  it('opens a single upstream connection on the leader tab, fans out events and state to follower tabs, and promotes follower on leader close', () => {
    const hub = new FakeBroadcastHub()
    let upstreamConnectionsOpened = 0
    const followerEvents: Array<{ topic: string; payload: unknown; seq?: number }> = []
    const followerStates: FanoutConnectionState[] = []
    let followerPromotedTopics: string[] = []

    const leaderTab = new BroadcastChannelFanoutNode({
      tabId: 'tab-1-leader',
      createChannel: (name) => hub.createChannel(name),
      onLeaderPromoted: () => {
        upstreamConnectionsOpened += 1
      },
    })

    const followerTab = new BroadcastChannelFanoutNode({
      tabId: 'tab-2-follower',
      createChannel: (name) => hub.createChannel(name),
      onLeaderPromoted: (topics) => {
        upstreamConnectionsOpened += 1
        followerPromotedTopics = topics
      },
      onForwardedEvent: (evt) => followerEvents.push(evt),
      onConnectionStateChange: (state) => followerStates.push(state),
    })

    followerTab.registerTopic('oracle:XLM/USD')
    followerTab.registerTopic('claims:GABC')

    leaderTab.start(true)
    followerTab.start(false)

    // Only 1 upstream connection opened (by leaderTab)
    expect(upstreamConnectionsOpened).toBe(1)
    expect(leaderTab.getRole()).toBe('leader')
    expect(followerTab.getRole()).toBe('follower')

    // Leader broadcasts state and event -> follower receives both without echoing
    leaderTab.publishConnectionState('connected')
    leaderTab.publishUpstreamEvent({
      topic: 'oracle:XLM/USD',
      payload: { price: 0.125 },
      seq: 7,
      timestamp: 1_700_000_000_000,
    })

    expect(followerStates).toEqual(['connected'])
    expect(followerEvents).toEqual([
      {
        topic: 'oracle:XLM/USD',
        payload: { price: 0.125 },
        seq: 7,
        timestamp: 1_700_000_000_000,
      },
    ])

    // Leader tab closes -> follower promotes itself and re-establishes its active subscriptions
    leaderTab.close()
    expect(followerTab.getRole()).toBe('leader')
    expect(upstreamConnectionsOpened).toBe(2)
    expect(followerPromotedTopics).toEqual(['oracle:XLM/USD', 'claims:GABC'])

    followerTab.close()
  })

  it('ignores malformed or schema-mismatched BroadcastChannel messages with diagnostics and degrades gracefully without BroadcastChannel', () => {
    const hub = new FakeBroadcastHub()
    const diagnostics: string[] = []
    const receivedEvents: unknown[] = []

    const follower = new BroadcastChannelFanoutNode({
      tabId: 'tab-follower',
      createChannel: (name) => hub.createChannel(name),
      onForwardedEvent: (evt) => receivedEvents.push(evt),
      onMalformedMessage: (_raw, reason) => diagnostics.push(reason),
    })
    follower.start(false)

    const rawPeer = hub.createChannel(follower.getChannelName())
    rawPeer.postMessage('not-an-object')
    rawPeer.postMessage({ schemaVersion: 999, type: 'event' })
    rawPeer.postMessage({
      schemaVersion: 1,
      type: 'event',
      senderTabId: 'tab-other',
      timestamp: 123,
      // missing topic
    })

    expect(receivedEvents).toHaveLength(0)
    expect(diagnostics).toHaveLength(3)
    follower.close()

    // Graceful degradation when BroadcastChannel is unavailable
    let standalonePromoted = false
    const standalone = new BroadcastChannelFanoutNode({
      createChannel: () => null,
      onLeaderPromoted: () => {
        standalonePromoted = true
      },
    })
    standalone.start(false)
    expect(standalone.getRole()).toBe('leader')
    expect(standalonePromoted).toBe(true)
    standalone.close()
  })
})
