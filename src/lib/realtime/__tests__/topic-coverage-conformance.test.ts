import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REALTIME_TOPIC_CONTRACT,
  verifyTopicCoverageConformance,
} from '../topic-coverage-conformance';

describe('verifyTopicCoverageConformance', () => {
  const validMockProducers = {
    'policies.updated': () => ({ policyId: 'pol-1', status: 'active' }),
    'claims.updated': () => ({ claimId: 'clm-1', status: 'settled' }),
    'liquidity.pool': () => ({ poolId: 'pool-main', tvlStroops: '1000000000' }),
    'protocol.stats': () => ({ totalPolicies: 42, activeCoverageUsd: 250000 }),
  };

  const validConsumers = {
    'policies.updated': ['src/hooks/usePolicies.ts'],
    'claims.updated': ['src/hooks/useClaims.ts'],
    'liquidity.pool': ['src/app/provide/page.tsx'],
    'protocol.stats': ['src/app/page.tsx'],
  };

  const validFixtures = {
    'policies.updated': [{ policyId: 'pol-1', status: 'active' }],
    'claims.updated': [{ claimId: 'clm-1', status: 'settled' }],
    'liquidity.pool': [{ poolId: 'pool-main', tvlStroops: '1000000000' }],
    'protocol.stats': [{ totalPolicies: 42, activeCoverageUsd: 250000 }],
  };

  it('passes when every contract topic has a mock producer, consumer reference, and valid fixture', () => {
    const report = verifyTopicCoverageConformance({
      contractTopics: DEFAULT_REALTIME_TOPIC_CONTRACT,
      mockProducers: validMockProducers,
      consumerReferences: validConsumers,
      fixtures: validFixtures,
    });

    expect(report.valid).toBe(true);
    expect(report.checkedTopicCount).toBe(4);
    expect(report.violations).toHaveLength(0);
  });

  it('meta-test: fails and names offending topics when producer, consumer, or fixture validation is broken', () => {
    const brokenReport = verifyTopicCoverageConformance({
      contractTopics: DEFAULT_REALTIME_TOPIC_CONTRACT,
      mockProducers: {
        ...validMockProducers,
        'claims.updated': undefined as unknown as () => unknown,
      },
      consumerReferences: {
        ...validConsumers,
        'liquidity.pool': [],
      },
      fixtures: {
        ...validFixtures,
        'protocol.stats': [{ totalPolicies: 'not-a-number' }],
      },
      unconsumedAllowlist: {
        'nonexistent.topic': 'Legacy topic removed in v2',
      },
    });

    expect(brokenReport.valid).toBe(false);
    expect(brokenReport.violations.map((v) => `${v.topic}:${v.code}`)).toEqual([
      'claims.updated:missing_producer',
      'liquidity.pool:missing_consumer',
      'protocol.stats:invalid_fixture',
      'nonexistent.topic:stale_allowlist_entry',
    ]);
  });
});
