/**
 * Single source of truth mapping realtime topics to the Next.js cache tags
 * their events invalidate. Topics absent from the map only affect client
 * state and never trigger a refresh.
 */
export const TOPIC_REVALIDATION_TAGS: Readonly<Record<string, readonly string[]>> = {
  oracle_update: ["oracle", "pool-stats"],
  pool_stats: ["pool-stats"],
  claim_update: ["claims", "policies"],
  policy_update: ["policies"],
};

export const REFRESH_WINDOW_MS = 2_000;

export const tagsForTopic = (topic: string): readonly string[] =>
  TOPIC_REVALIDATION_TAGS[topic] ?? [];

export interface RefreshSchedulerOptions {
  refresh: (tags: string[]) => void;
  windowMs?: number;
  /** Return true to defer (e.g. in-flight navigation or purchase confirm step). */
  isBlocked?: () => boolean;
  enabled?: () => boolean;
  log?: (msg: string) => void;
}

/** Coalesces bursts of topic events into at most one refresh per window. */
export function createRefreshScheduler({
  refresh,
  windowMs = REFRESH_WINDOW_MS,
  isBlocked = () => false,
  enabled = () => true,
  log = () => {},
}: RefreshSchedulerOptions) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (pending.size === 0) return;
    if (isBlocked()) {
      timer = setTimeout(flush, windowMs);
      return;
    }
    const tags = [...pending];
    pending.clear();
    refresh(tags);
  };

  return {
    notify(topic: string): void {
      const tags = tagsForTopic(topic);
      if (tags.length === 0) return;
      if (!enabled()) {
        log(`realtime revalidation disabled; ignoring "${topic}"`);
        return;
      }
      tags.forEach((t) => pending.add(t));
      if (!timer) timer = setTimeout(flush, windowMs);
    },
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}
