import { topicsForRoute } from "@/app/realtime-topics";
import type { RealtimeClient } from "./client";

/** One route owner. Retains intersection; batches quick navigation bursts. */
export class RouteSubscriptions {
  private active = new Map<string, () => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private session: number | undefined;
  private warmed = new Map<string, () => void>();
  constructor(
    private client: Pick<RealtimeClient, "subscribe"> &
      Partial<Pick<RealtimeClient, "teardownVersion">>,
    private snapshot: (topic: string) => Promise<unknown> = async () => {}
  ) {
    this.session = client.teardownVersion;
  }
  private synchronize(): void {
    if (this.session !== this.client.teardownVersion) {
      this.dispose();
      this.session = this.client.teardownVersion;
    }
  }
  navigate(pathname: string): void {
    this.synchronize();
    const session = this.session;
    const revision = ++this.revision;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.apply(topicsForRoute(pathname), revision, session);
    }, 40);
  }
  /** Optional link intent: bounded by the finite route topic sets, released after 5s. */
  prefetch(pathname: string): void {
    this.synchronize();
    const session = this.session;
    const topics = topicsForRoute(pathname);
    const key = topics.join(",");
    if (!topics.length || this.warmed.has(key)) return;
    let cancelled = false;
    const releases: Array<() => void> = [];
    const timer = setTimeout(() => release(), 5000);
    const release = () => {
      cancelled = true;
      clearTimeout(timer);
      releases.forEach((off) => off());
      this.warmed.delete(key);
    };
    this.warmed.set(key, release);
    void Promise.all(topics.map((topic) => this.snapshot(topic).catch(() => undefined))).then(
      () => {
        if (cancelled || session !== this.client.teardownVersion) return;
        for (const topic of topics) {
          try {
            releases.push(this.client.subscribe(topic, () => {}));
          } catch {
            /* The client records capacity diagnostics; prefetch is optional. */
          }
        }
      }
    );
  }
  private async apply(topics: readonly string[], revision: number, session: number | undefined) {
    // Snapshot acquisition never blocks rendering; failures retain REST fallback.
    await Promise.all(
      topics.filter((t) => !this.active.has(t)).map((t) => this.snapshot(t).catch(() => undefined))
    );
    if (revision !== this.revision || session !== this.client.teardownVersion) return;
    for (const topic of topics)
      if (!this.active.has(topic)) {
        try {
          this.active.set(
            topic,
            this.client.subscribe(topic, () => {})
          );
        } catch {
          /* Capacity is reported by the client; keep REST fallback. */
        }
      }
    for (const [topic, release] of this.active)
      if (!topics.includes(topic)) {
        release();
        this.active.delete(topic);
      }
  }
  dispose(): void {
    this.revision++;
    clearTimeout(this.timer);
    this.active.forEach((release) => release());
    this.active.clear();
    this.warmed.forEach((release) => release());
    this.warmed.clear();
  }
}
