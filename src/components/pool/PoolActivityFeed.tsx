"use client";

import { Card, RelativeDate } from "@/components/ui";
import { usePoolActivity } from "@/hooks/usePoolActivity";
import type { RealtimeStatus } from "@/lib/realtime/client";

const KIND_LABEL = {
  deposit: "Deposit",
  withdraw: "Withdrawal",
  coverage_written: "Coverage written",
} as const;

const STATUS_COPY: Partial<Record<RealtimeStatus, string>> = {
  connecting: "Connecting…",
  resyncing: "Reconnecting and resyncing…",
  offline: "Offline — activity may be out of date",
};

export function PoolActivityFeed() {
  const { feed, presence, status } = usePoolActivity();
  const notice = STATUS_COPY[status];

  return (
    <Card padding="md" data-testid="pool-activity">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-bold tracking-tight text-pm-text">
          Live pool activity
        </h3>
        <span className="text-xs text-pm-text/60" data-testid="pool-presence">
          {presence === null
            ? "Presence unavailable"
            : `${presence} ${presence === 1 ? "provider" : "providers"} active now`}
        </span>
      </div>
      {notice && (
        <p role="status" className="mb-3 text-xs text-pm-amber" data-testid="realtime-degraded">
          {notice}
        </p>
      )}
      {feed.length === 0 ? (
        <p className="text-xs text-pm-text/40">No recent activity.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="pool-activity-feed">
          {feed.map((e) => (
            <li key={e.id} className="flex items-center justify-between text-xs text-pm-text/70">
              <span>
                {KIND_LABEL[e.kind]}
                {e.sizeBucket ? ` · ${e.sizeBucket}` : ""}
              </span>
              <RelativeDate target={e.at} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
