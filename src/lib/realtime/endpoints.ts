export interface EndpointHealth {
  url: string;
  failures: number;
  lastSuccess?: number;
  lastFailure?: number;
  firstMessageMs?: number;
}
/** Instance scoped to one network. Preferred retries use the existing socket slot, never a parallel probe. */
export class EndpointSelector {
  readonly health: EndpointHealth[];
  private lastPreferredTrial: number;
  constructor(
    urls: string[],
    private now = Date.now,
    readonly retryPreferredMs = 60_000
  ) {
    if (!urls.length) throw new Error("At least one realtime endpoint required");
    this.health = [...new Set(urls)].map((url) => ({ url, failures: 0 }));
    this.lastPreferredTrial = now();
  }
  select(): EndpointHealth {
    if (this.now() - this.lastPreferredTrial >= this.retryPreferredMs) {
      this.lastPreferredTrial = this.now();
      return this.health[0]!;
    }
    return this.health.reduce((best, item) => (this.score(item) < this.score(best) ? item : best));
  }
  /** Failure dominates; recent successes and lower first-message latency break ties. */
  score(endpoint: EndpointHealth): number {
    const age =
      endpoint.lastSuccess === undefined
        ? 100
        : Math.min(50, Math.max(0, this.now() - endpoint.lastSuccess) / 60_000);
    return endpoint.failures * 1000 + age + Math.min(50, (endpoint.firstMessageMs ?? 0) / 10);
  }
  failed(endpoint: EndpointHealth) {
    endpoint.failures++;
    endpoint.lastFailure = this.now();
  }
  succeeded(endpoint: EndpointHealth, firstMessageMs: number) {
    endpoint.failures = 0;
    endpoint.lastSuccess = this.now();
    endpoint.firstMessageMs = firstMessageMs;
  }
}
