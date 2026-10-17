import { describe, expect, it } from 'vitest'
import {
  RealtimeTopicFlagRegistry,
  type KnownRealtimeTopicFamily,
  type TopicFlagChangeReason,
} from './topicFlags'

describe('RealtimeTopicFlagRegistry (#308)', () => {
  it('resolves per-topic flags across precedence order (kill > override > flags.json > default false) and fails closed on malformed entries', () => {
    const malformedLogs: string[] = []
    const registry = new RealtimeTopicFlagRegistry({
      initialFlags: {
        'realtime-oracle': false,
        realtimeTopics: {
          oracle: { enabled: true }, // overrides legacy flat 'realtime-oracle': false
          claims: false,
          pool: { enabled: true, killed: true }, // killed overrides enabled
          notifications: 'invalid-string-value', // malformed -> fails closed to false
          unknownTopic: true, // unknown topic -> logged and ignored
        },
      },
      onMalformedEntry: (key) => malformedLogs.push(key),
    })

    expect(registry.isTopicEnabled('oracle:XLM/USD')).toBe(true)
    expect(registry.isTopicEnabled('claims:GABC')).toBe(false)
    expect(registry.isTopicEnabled('pool:main')).toBe(false)
    expect(registry.isTopicEnabled('notifications:GABC')).toBe(false)
    expect(registry.isTopicEnabled('arbitrary:unknown')).toBe(false)

    expect(malformedLogs).toEqual([
      'realtimeTopics.notifications',
      'realtimeTopics.unknownTopic',
      'arbitrary:unknown',
    ])

    // Local override enables 'claims', but cannot defeat explicit kill on 'pool'
    registry.setTopicOverride('claims', true)
    registry.setTopicOverride('pool', true)
    expect(registry.isTopicEnabled('claims:GABC')).toBe(true)
    expect(registry.isTopicEnabled('pool:main')).toBe(false)
  })

  it('prevents subscriptions on disabled topics and tears down active subscriptions when a topic is killed mid-session', () => {
    const activeWireSubscriptions = new Set<string>()
    const transitions: Array<{
      family: KnownRealtimeTopicFamily
      enabled: boolean
      reason: TopicFlagChangeReason
    }> = []

    const registry = new RealtimeTopicFlagRegistry({
      initialFlags: {
        realtimeTopics: {
          oracle: true,
          claims: false,
        },
      },
      onTopicStateChanged: (family, enabled, reason) => {
        transitions.push({ family, enabled, reason })
        if (!enabled) {
          for (const sub of Array.from(activeWireSubscriptions)) {
            if (sub.startsWith(`${family}:`)) {
              activeWireSubscriptions.delete(sub)
            }
          }
        }
      },
    })

    // Helper simulating subscription gate
    const attemptSubscribe = (topic: string): 'subscribed' | 'fallback_rest' => {
      if (!registry.isTopicEnabled(topic)) {
        return 'fallback_rest'
      }
      activeWireSubscriptions.add(topic)
      return 'subscribed'
    }

    // Disabled topic ('claims:GABC') performs zero subscriptions and uses REST
    expect(attemptSubscribe('claims:GABC')).toBe('fallback_rest')
    expect(attemptSubscribe('oracle:XLM/USD')).toBe('subscribed')
    expect(Array.from(activeWireSubscriptions)).toEqual(['oracle:XLM/USD'])

    // Kill 'oracle' mid-session -> immediately tears down 'oracle:XLM/USD'
    registry.killTopic('oracle')
    expect(Array.from(activeWireSubscriptions)).toEqual([])
    expect(transitions).toEqual([
      { family: 'oracle', enabled: false, reason: 'topic_killed' },
    ])
  })
})
