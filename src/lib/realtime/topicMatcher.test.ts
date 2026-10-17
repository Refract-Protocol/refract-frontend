import { describe, expect, it, vi } from 'vitest'
import {
  TopicPatternRouter,
  TopicPatternValidationError,
  compileTopicPattern,
} from './topicMatcher'

describe('compileTopicPattern & TopicPatternRouter (#269)', () => {
  it('evaluates table-driven exact, single-level wildcard (*), and multi-level tail wildcard (**) patterns', () => {
    const cases: Array<{
      pattern: string
      matching: string[]
      nonMatching: string[]
    }> = [
      {
        pattern: 'oracle:XLM/USD',
        matching: ['oracle:XLM/USD'],
        nonMatching: ['oracle:USDC/USD', 'oracle:XLM/USD:extra', 'pool:main'],
      },
      {
        pattern: 'oracle:*',
        matching: ['oracle:XLM/USD', 'oracle:USDC/USD', 'oracle:BTC/USD'],
        nonMatching: ['oracle:XLM/USD:v2', 'pool:main'],
      },
      {
        pattern: 'claims:*:settled',
        matching: ['claims:GABC:settled', 'claims:GXYZ:settled'],
        nonMatching: ['claims:GABC:pending', 'claims:GABC', 'claims:GABC:settled:extra'],
      },
      {
        pattern: 'pool:main:**',
        matching: [
          'pool:main:stats',
          'pool:main:tranche:senior',
          'pool:main:tranche:junior:apy',
        ],
        nonMatching: ['pool:main', 'pool:secondary:stats'],
      },
    ]

    for (const tc of cases) {
      const compiled = compileTopicPattern(tc.pattern)
      for (const hit of tc.matching) {
        expect(
          compiled.matches(hit),
          `Expected "${tc.pattern}" to match "${hit}"`
        ).toBe(true)
      }
      for (const miss of tc.nonMatching) {
        expect(
          compiled.matches(miss),
          `Expected "${tc.pattern}" NOT to match "${miss}"`
        ).toBe(false)
      }
    }
  })

  it('fails fast with TopicPatternValidationError on malformed subscription patterns', () => {
    const invalidPatterns = [
      '',
      'oracle',
      'oracle:',
      ':XLM/USD',
      'oracle::XLM/USD',
      '*:XLM/USD',
      '**:XLM/USD',
      'claims:**:settled',
      'oracle:XLM*',
    ]

    for (const invalid of invalidPatterns) {
      expect(
        () => compileTopicPattern(invalid),
        `Expected "${invalid}" to throw TopicPatternValidationError`
      ).toThrow(TopicPatternValidationError)
    }
  })

  it('guarantees single delivery per listener when matching both exact and wildcard subscriptions and expands wire topics', () => {
    const router = new TopicPatternRouter<{ price: number }>({
      serverSupportsWildcards: false,
    })

    const sharedListener = vi.fn()
    const wildcardOnlyListener = vi.fn()

    // Register sharedListener under BOTH exact and wildcard patterns
    router.subscribe('oracle:XLM/USD', sharedListener)
    router.subscribe('oracle:*', sharedListener)
    router.subscribe('oracle:*', wildcardOnlyListener)

    const deliveredCount = router.route('oracle:XLM/USD', { price: 0.125 })

    expect(deliveredCount).toBe(2)
    expect(sharedListener).toHaveBeenCalledTimes(1)
    expect(wildcardOnlyListener).toHaveBeenCalledTimes(1)

    // Wire expansion when serverSupportsWildcards is false
    const wireTopics = router.resolveWireSubscriptions([
      'oracle:XLM/USD',
      'oracle:USDC/USD',
      'pool:main',
    ])
    expect(wireTopics).toEqual(['oracle:USDC/USD', 'oracle:XLM/USD'])
  })
})
