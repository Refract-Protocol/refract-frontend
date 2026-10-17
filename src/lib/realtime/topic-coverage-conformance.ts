export interface TopicContractDefinition<T = unknown> {
  topic: string;
  validatePayload: (payload: unknown) => payload is T;
}

export interface TopicCoverageInput {
  contractTopics: readonly TopicContractDefinition[];
  mockProducers: Readonly<Record<string, () => unknown>>;
  consumerReferences: Readonly<Record<string, readonly string[]>>;
  fixtures: Readonly<Record<string, readonly unknown[]>>;
  unconsumedAllowlist?: Readonly<Record<string, string>>;
}

export interface TopicCoverageViolation {
  topic: string;
  code:
    | 'missing_producer'
    | 'missing_consumer'
    | 'missing_fixture'
    | 'invalid_fixture'
    | 'empty_allowlist_reason'
    | 'stale_allowlist_entry';
  message: string;
}

export interface TopicCoverageReport {
  valid: boolean;
  checkedTopicCount: number;
  violations: TopicCoverageViolation[];
}

export const DEFAULT_REALTIME_TOPIC_CONTRACT: readonly TopicContractDefinition[] = [
  {
    topic: 'policies.updated',
    validatePayload: (p): p is { policyId: string; status: string } =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as Record<string, unknown>).policyId === 'string' &&
      typeof (p as Record<string, unknown>).status === 'string',
  },
  {
    topic: 'claims.updated',
    validatePayload: (p): p is { claimId: string; status: string } =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as Record<string, unknown>).claimId === 'string' &&
      typeof (p as Record<string, unknown>).status === 'string',
  },
  {
    topic: 'liquidity.pool',
    validatePayload: (p): p is { poolId: string; tvlStroops: string } =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as Record<string, unknown>).poolId === 'string' &&
      typeof (p as Record<string, unknown>).tvlStroops === 'string',
  },
  {
    topic: 'protocol.stats',
    validatePayload: (p): p is { totalPolicies: number; activeCoverageUsd: number } =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as Record<string, unknown>).totalPolicies === 'number' &&
      typeof (p as Record<string, unknown>).activeCoverageUsd === 'number',
  },
];

/**
 * Verifies that every topic declared in the realtime contract has a mock producer,
 * at least one consumer (or a valid documented allowlist entry), and valid fixtures.
 */
export function verifyTopicCoverageConformance(
  input: TopicCoverageInput
): TopicCoverageReport {
  const violations: TopicCoverageViolation[] = [];
  const allowlist = input.unconsumedAllowlist ?? {};
  const contractTopicSet = new Set(input.contractTopics.map((t) => t.topic));

  for (const def of input.contractTopics) {
    const { topic, validatePayload } = def;

    // 1. Mock producer check
    const producer = input.mockProducers[topic];
    if (typeof producer !== 'function') {
      violations.push({
        topic,
        code: 'missing_producer',
        message: `Topic "${topic}" has no registered mock producer.`,
      });
    } else {
      const sample = producer();
      if (!validatePayload(sample)) {
        violations.push({
          topic,
          code: 'invalid_fixture',
          message: `Mock producer output for topic "${topic}" failed runtime schema validation.`,
        });
      }
    }

    // 2. Consumer reference or allowlist check
    const consumers = input.consumerReferences[topic] ?? [];
    const allowReason = allowlist[topic];
    if (consumers.length === 0) {
      if (allowReason === undefined) {
        violations.push({
          topic,
          code: 'missing_consumer',
          message: `Topic "${topic}" has no active consumer references and is not in unconsumedAllowlist.`,
        });
      } else if (allowReason.trim().length === 0) {
        violations.push({
          topic,
          code: 'empty_allowlist_reason',
          message: `Topic "${topic}" in unconsumedAllowlist must provide a non-empty reason string.`,
        });
      }
    } else if (allowReason !== undefined) {
      violations.push({
        topic,
        code: 'stale_allowlist_entry',
        message: `Topic "${topic}" has active consumers (${consumers.join(', ')}) and must be removed from unconsumedAllowlist.`,
      });
    }

    // 3. Fixture validation check
    const topicFixtures = input.fixtures[topic];
    if (!topicFixtures || topicFixtures.length === 0) {
      violations.push({
        topic,
        code: 'missing_fixture',
        message: `Topic "${topic}" has no registered test fixtures.`,
      });
    } else {
      for (let i = 0; i < topicFixtures.length; i++) {
        if (!validatePayload(topicFixtures[i])) {
          violations.push({
            topic,
            code: 'invalid_fixture',
            message: `Fixture[${i}] for topic "${topic}" failed runtime schema validation.`,
          });
        }
      }
    }
  }

  // 4. Stale allowlist entries for nonexistent topics
  for (const allowTopic of Object.keys(allowlist)) {
    if (!contractTopicSet.has(allowTopic)) {
      violations.push({
        topic: allowTopic,
        code: 'stale_allowlist_entry',
        message: `Allowlist entry "${allowTopic}" does not match any topic in the contract.`,
      });
    }
  }

  return {
    valid: violations.length === 0,
    checkedTopicCount: input.contractTopics.length,
    violations,
  };
}
