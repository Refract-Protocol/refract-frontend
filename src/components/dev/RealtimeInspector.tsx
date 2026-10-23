'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { realtimeClient } from '@/lib/realtime/client';
import { useRealtimeHealth } from '@/hooks/useRealtimeHealth';

export type RealtimeDirection = 'in' | 'out';

export interface RealtimeInspectorMessage {
  id: string;
  topic: string;
  sequence: number | null;
  timestamp: number;
  direction: RealtimeDirection;
  payload: unknown;
  merged?: unknown;
}

const MAX_LOG_LENGTH = 100;
const MAX_PAYLOAD_CHARS = 500;

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function safeStringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(
      value,
      (key, val) => {
        if (key === 'token' || key === 'auth' || key === 'authorization') return '[redacted]';
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[circular]';
          seen.add(val);
        }
        return val;
      },
      2,
    );
    if (json === undefined) return String(value);
    return json.length > MAX_PAYLOAD_CHARS ? `${json.slice(0, MAX_PAYLOAD_CHARS)}…` : json;
  } catch {
    return '[unserializable]';
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function appendBounded(
  prev: RealtimeInspectorMessage[],
  next: RealtimeInspectorMessage,
): RealtimeInspectorMessage[] {
  const merged = [...prev, next];
  return merged.length > MAX_LOG_LENGTH ? merged.slice(merged.length - MAX_LOG_LENGTH) : merged;
}

export function RealtimeInspector() {
  const [messages, setMessages] = useState<RealtimeInspectorMessage[]>([]);
  const [view, setView] = useState<'raw' | 'merged'>('raw');
  const [open, setOpen] = useState(false);
  const counterRef = useRef(0);
  const health = useRealtimeHealth();

  useEffect(() => {
    if (!isDev()) return;
    const client = realtimeClient as unknown as {
      on?: (event: string, handler: (payload: unknown) => void) => () => void;
      off?: (event: string, handler: (payload: unknown) => void) => void;
    };
    if (typeof client.on !== 'function') return;

    const handle = (direction: RealtimeDirection) => (payload: unknown) => {
      const record = (payload ?? {}) as Record<string, unknown>;
      const topic = typeof record.topic === 'string' ? record.topic : 'unknown';
      const sequence = typeof record.sequence === 'number' ? record.sequence : null;
      const timestamp = typeof record.timestamp === 'number' ? record.timestamp : Date.now();
      counterRef.current += 1;
      const entry: RealtimeInspectorMessage = {
        id: `${timestamp}-${counterRef.current}`,
        topic,
        sequence,
        timestamp,
        direction,
        payload: record.payload ?? record,
        merged: record.merged,
      };
      setMessages((prev) => appendBounded(prev, entry));
    };

    const onIn = handle('in');
    const onOut = handle('out');
    const unsubIn = client.on('message', onIn);
    const unsubOut = client.on('send', onOut);

    return () => {
      if (typeof unsubIn === 'function') unsubIn();
      else client.off?.('message', onIn);
      if (typeof unsubOut === 'function') unsubOut();
      else client.off?.('send', onOut);
    };
  }, []);

  const snapshot = useMemo(() => messages.slice(), [messages]);

  if (!isDev()) return null;

  return (
    <div
      data-testid="realtime-inspector"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        width: 420,
        maxHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#111',
        color: '#eee',
        fontFamily: 'monospace',
        fontSize: 11,
        border: '1px solid #333',
        borderRadius: 6,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderBottom: '1px solid #333',
        }}
      >
        <span>
          Realtime Inspector · {health?.status ?? 'unknown'}
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => setView('raw')} disabled={view === 'raw'}>
            Raw
          </button>
          <button type="button" onClick={() => setView('merged')} disabled={view === 'merged'}>
            Merged
          </button>
          <button type="button" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </span>
      </div>
      {open && (
        <div style={{ overflowY: 'auto', padding: 6 }}>
          {snapshot.length === 0 ? (
            <div style={{ opacity: 0.6 }}>No messages yet.</div>
          ) : (
            snapshot.map((msg) => (
              <div key={msg.id} style={{ borderBottom: '1px solid #222', padding: '4px 0' }}>
                <div>
                  <strong>{msg.direction === 'in' ? '←' : '→'}</strong> {msg.topic}
                  {msg.sequence !== null ? ` #${msg.sequence}` : ''}{' '}
                  <span style={{ opacity: 0.6 }}>{formatTimestamp(msg.timestamp)}</span>
                </div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {safeStringify(view === 'merged' ? msg.merged ?? msg.payload : msg.payload)}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default RealtimeInspector;
