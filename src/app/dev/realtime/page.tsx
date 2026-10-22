"use client";

import { useEffect, useMemo, useState } from "react";
import { useRealtimeTopic } from "@/hooks/useRealtimeTopic";
import { defaultEndpoints, defaultTransportFactories } from "@/lib/realtime/capabilities";
import {
  RealtimeClient,
  realtimeClient,
  type GapInfo,
  type RealtimeStats,
} from "@/lib/realtime/client";

/**
 * Dev-only realtime panel: connection status, negotiated transport, decode
 * path, de-duplication counters and a live event log.
 *
 * Gated by the /dev layout (`NEXT_PUBLIC_ENABLE_UI_GALLERY`). Point it at the
 * mock server with `?api=http://127.0.0.1:4010/api/v1` (see
 * `npm run mock:realtime`); without it, it inspects the app-wide client.
 */

const TOPIC = "oracle_update";

function useClient(): RealtimeClient | null {
  const [client, setClient] = useState<RealtimeClient | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const api = params.get("api");
    if (!api) {
      setClient(realtimeClient);
      return;
    }
    const only = params.get("transport");
    const factories = defaultTransportFactories(defaultEndpoints(api)).filter(
      (f) => !only || f.kind === only
    );
    const dedicated = new RealtimeClient({
      transports: factories,
      idleTimeoutMs: Number(params.get("idleMs") ?? 15_000),
      backoffBaseMs: 500,
      backoffMaxMs: 4_000,
      subscribeAckTimeoutMs: 3_000,
      degradedRetryMs: 30_000,
    });
    setClient(dedicated);
    return () => dedicated.disconnect();
  }, []);
  return client;
}

export default function RealtimeDevPage() {
  const client = useClient();
  return client ? <Panel client={client} /> : null;
}

function Panel({ client }: { client: RealtimeClient }) {
  const [events, setEvents] = useState<Array<{ id?: string; seq?: number; payload: unknown }>>([]);
  const [gaps, setGaps] = useState<GapInfo[]>([]);
  const [stats, setStats] = useState<RealtimeStats>(() => client.getStats());

  const { status, degraded } = useRealtimeTopic(TOPIC, {
    client,
    onEvent: (payload, meta) =>
      setEvents((prev) => [{ id: meta.id, seq: meta.seq, payload }, ...prev].slice(0, 25)),
    onGap: (gap) => setGaps((prev) => [gap, ...prev].slice(0, 10)),
  });

  useEffect(() => {
    const timer = setInterval(() => setStats(client.getStats()), 250);
    return () => clearInterval(timer);
  }, [client]);

  const counters = useMemo(
    () =>
      [
        ["Duplicates dropped", stats.dedupe.duplicatesDropped, "duplicates"],
        ["Events without id", stats.dedupe.missingId, "missing-id"],
        ["Events delivered", stats.eventsDelivered, "delivered"],
        ["Reconnects", stats.reconnects, "reconnects"],
        ["Idle timeouts", stats.idleTimeouts, "idle-timeouts"],
        ["Subscribe retries", stats.subscribeRetries, "subscribe-retries"],
        ["Resume gaps", stats.resumeGaps, "resume-gaps"],
        ["Sequence gaps", stats.sequenceGaps, "sequence-gaps"],
        [
          "Decode errors",
          stats.decodeErrors.invalid_json +
            stats.decodeErrors.invalid_shape +
            stats.decodeErrors.too_large,
          "decode-errors",
        ],
        ["Decoded on worker", stats.decoder.decodedOnWorker, "decoded-worker"],
        ["Decoded on main thread", stats.decoder.decodedOnMain, "decoded-main"],
      ] as const,
    [stats]
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Realtime</h1>
        <p className="text-sm opacity-70">Connection, transport and de-duplication diagnostics.</p>
      </header>

      {degraded && (
        <div
          role="status"
          data-testid="realtime-degraded"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          Live updates are paused
          {stats.degradedReason === "auth" ? " (sign-in expired)" : ""}. Data refreshes periodically
          instead.
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Status" value={status} testId="realtime-status" />
        <Field label="Transport" value={stats.transport ?? "—"} testId="realtime-transport" />
        <Field label="Decode path" value={stats.decoder.mode} testId="realtime-decode-mode" />
        <Field
          label="Degraded reason"
          value={stats.degradedReason ?? "—"}
          testId="realtime-degraded-reason"
        />
      </dl>

      <section>
        <h2 className="mb-2 font-medium">Counters</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {counters.map(([label, value, id]) => (
            <Field key={id} label={label} value={String(value)} testId={`realtime-count-${id}`} />
          ))}
        </dl>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Negotiation</h2>
        <ol className="list-decimal pl-5 text-sm" data-testid="realtime-negotiation">
          {stats.negotiation.map((n, i) => (
            <li key={i}>
              {n.kind}: {n.outcome}
            </li>
          ))}
        </ol>
      </section>

      {gaps.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Gaps (refetch triggered)</h2>
          <ul className="text-sm" data-testid="realtime-gaps">
            {gaps.map((g, i) => (
              <li key={i}>
                {g.topic}: {g.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-medium">
          Recent <code>{TOPIC}</code> events
        </h2>
        <ul className="space-y-1 font-mono text-xs" data-testid="realtime-events">
          {events.map((e) => (
            <li key={e.id ?? `${e.seq}-${JSON.stringify(e.payload)}`}>
              #{e.seq ?? "?"} {e.id ?? "(no id)"} {JSON.stringify(e.payload)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Field({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border border-current/10 p-3">
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="font-mono text-sm" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
