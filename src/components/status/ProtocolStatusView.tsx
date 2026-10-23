"use client";

import { useEffect, useState } from "react";

import { Badge, Card, RealtimeView, Skeleton, TextBlockSkeleton } from "@/components/ui";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { ACTIVE_NETWORK } from "@/lib/network";
import type { ProtocolStatus, ProtocolStatusLevel } from "@/lib/realtime";
import { fetchProtocolStatus } from "@/lib/realtime/status";

const LEVEL_COPY: Record<
  ProtocolStatusLevel,
  { label: string; icon: string; description: string }
> = {
  healthy: { label: "Healthy", icon: "✓", description: "All systems are operating normally." },
  degraded: {
    label: "Degraded",
    icon: "!",
    description: "Some data may be delayed or temporarily unavailable.",
  },
  maintenance: {
    label: "Maintenance",
    icon: "⚙",
    description: "Scheduled maintenance is in progress.",
  },
  unknown: {
    label: "Unknown",
    icon: "?",
    description: "We can't determine protocol status right now.",
  },
};

const formatTime = (iso: string) =>
  Number.isNaN(Date.parse(iso))
    ? "—"
    : new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ProtocolStatusView({ initial }: { initial?: ProtocolStatus }) {
  const [snapshot, setSnapshot] = useState<ProtocolStatus | undefined>(initial);
  const { data: live, status } = useRealtimeTopic("protocol_status", { initial });

  // REST snapshot: first paint when nothing was server-rendered, and refetch on network switch.
  useEffect(() => {
    let cancelled = false;
    void fetchProtocolStatus().then((s) => !cancelled && setSnapshot(s));
    return () => {
      cancelled = true;
    };
  }, [ACTIVE_NETWORK.id]);

  const current = live ?? snapshot;
  // Never show a banner that belongs to another environment.
  const data =
    current && (!current.network || current.network === ACTIVE_NETWORK.id) ? current : undefined;
  const copy = LEVEL_COPY[data?.level ?? "unknown"];

  return (
    <RealtimeView
      status={data ? (status === "empty" ? "polling" : status) : "empty"}
      skeleton={
        <Card>
          <Skeleton height={28} width={160} className="mb-3" />
          <TextBlockSkeleton lines={2} />
        </Card>
      }
    >
      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-pm-text" data-testid="status-level">
            <span aria-hidden="true">{copy.icon} </span>
            {copy.label}
          </h2>
          <Badge>{ACTIVE_NETWORK.label}</Badge>
        </div>
        <p className="text-sm text-pm-text/60">{copy.description}</p>
        {data?.maintenance && (
          <div
            className="mt-4 rounded-lg border border-pm-border p-3 text-sm text-pm-text/80"
            role="note"
          >
            <strong>Maintenance window:</strong> {formatTime(data.maintenance.startsAt)} –{" "}
            {formatTime(data.maintenance.endsAt)}
            {data.maintenance.message && (
              <p className="mt-1 text-pm-text/60">{data.maintenance.message}</p>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-pm-text/45">
          Last updated {data ? formatTime(data.updatedAt) : "—"}
        </p>
        {data?.incidents && data.incidents.length > 0 && (
          <ul
            className="mt-4 flex flex-col gap-2 text-sm text-pm-text/70"
            aria-label="Recent incidents"
          >
            {data.incidents.map((i) => (
              <li key={i.id}>
                {i.title} — {formatTime(i.at)} ({i.resolved ? "resolved" : "ongoing"})
              </li>
            ))}
          </ul>
        )}
      </Card>
    </RealtimeView>
  );
}
