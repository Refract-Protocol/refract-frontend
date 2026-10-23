"use client";

import { Container } from "@/components/ui/Container";
import { useRealtimeMetrics } from "@/lib/realtime/useRealtimeMetrics";

/**
 * Dev-only realtime diagnostics. Byte counts are decoded text-frame payloads
 * measured at the client decode point (cumulative for the page session, kept
 * across reconnects); WebSocket framing, TLS and compression are excluded.
 */
export default function RealtimeDiagnosticsPage() {
  const m = useRealtimeMetrics();
  return (
    <Container>
      <h1 className="py-6 text-xl font-bold">Realtime data usage</h1>
      <p className="text-sm">
        In {m.bytesIn} B · Out {m.bytesOut} B · {m.messages} messages · ~{m.bytesPerHour} B/hour
        (session total)
      </p>
      <table className="mt-4 text-sm">
        <thead>
          <tr>
            <th className="pr-4 text-left">Topic</th>
            <th className="pr-4 text-left">In (B)</th>
            <th className="pr-4 text-left">Out (B)</th>
            <th className="pr-4 text-left">Msgs</th>
            <th className="text-left">Avg payload (B)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(m.byTopic).map(([topic, t]) => (
            <tr key={topic}>
              <td className="pr-4">{topic}</td>
              <td className="pr-4">{t.in}</td>
              <td className="pr-4">{t.out}</td>
              <td className="pr-4">{t.messages}</td>
              <td>{t.avgPayload}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Container>
  );
}
