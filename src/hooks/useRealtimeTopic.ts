"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_NETWORK } from "@/lib/network";
import { realtimeClient } from "@/lib/realtime/client";
import { readSnapshot, readSnapshotSync, writeSnapshot } from "@/lib/realtime/snapshotCache";

export function useRealtimeTopic<T>(topic: string, fetchFallback: (signal: AbortSignal) => Promise<T>, wallet?: string, enabled = true) {
  const [initialSnapshot] = useState(() => readSnapshotSync<T>(topic, ACTIVE_NETWORK.id, wallet));
  const [stored, setStored] = useState<{ topic: string; value: T | null }>(() => ({ topic, value: initialSnapshot?.value ?? null }));
  const [isStale, setStale] = useState(true);
  const [isLoading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(() => initialSnapshot ? new Date(initialSnapshot.capturedAt) : null);
  const revisionRef = useRef(0);
  const generationRef = useRef(0);
  const refresh = useCallback(async () => {
    const controller = new AbortController();
    const revision = revisionRef.current;
    const generation = generationRef.current;
    setLoading(true);
    try {
      const value = await fetchFallback(controller.signal);
      if (generationRef.current !== generation || revisionRef.current !== revision) return value;
      revisionRef.current += 1;
      setStored({ topic, value }); setStale(false); setLoading(false); writeSnapshot(topic, ACTIVE_NETWORK.id, value, wallet);
      setUpdatedAt(new Date());
      return value;
    } catch (error) { if (generationRef.current === generation) setLoading(false); throw error; }
  }, [fetchFallback, topic, wallet]);
  useEffect(() => {
    let current = true;
    const generation = ++generationRef.current;
    if (!enabled) { setStored({ topic, value: null }); setLoading(false); return () => { current = false; }; }
    setStale(true); setLoading(true);
    revisionRef.current = 0;
    const controller = new AbortController();
    void readSnapshot<T>(topic, ACTIVE_NETWORK.id, wallet).then((snapshot) => {
      if (current && generationRef.current === generation && snapshot && revisionRef.current === 0) { setStored({ topic, value: snapshot.value }); setUpdatedAt(new Date(snapshot.capturedAt)); }
    });
    const off = realtimeClient.subscribe(topic, (payload) => {
      if (!current || realtimeClient.isDegraded(topic)) return;
      revisionRef.current += 1;
      setStored({ topic, value: payload as T }); setStale(false); setLoading(false);
      setUpdatedAt(new Date());
      writeSnapshot(topic, ACTIVE_NETWORK.id, payload as T, wallet);
    });
    const offError = realtimeClient.onError(topic, () => {
      if (!current || controller.signal.aborted) return;
      const revision = revisionRef.current;
      fetchFallback(controller.signal).then((value) => {
        if (!current || generationRef.current !== generation || revisionRef.current !== revision) return;
        revisionRef.current += 1;
        setStored({ topic, value }); setStale(false); setLoading(false); writeSnapshot(topic, ACTIVE_NETWORK.id, value, wallet);
        setUpdatedAt(new Date());
      }).catch(() => { if (current) setLoading(false); });
    });
    const startingRevision = revisionRef.current;
    fetchFallback(controller.signal).then((value) => {
      if (!current || generationRef.current !== generation || revisionRef.current !== startingRevision) return;
      revisionRef.current += 1;
      setStored({ topic, value }); setStale(false); setLoading(false); writeSnapshot(topic, ACTIVE_NETWORK.id, value, wallet);
      setUpdatedAt(new Date());
    }).catch(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); off(); offError(); };
  }, [topic, wallet, fetchFallback, enabled]);
  const data = stored.topic === topic
    ? stored.value
    : readSnapshotSync<T>(topic, ACTIVE_NETWORK.id, wallet)?.value ?? null;
  return { data, isStale, isLoading, updatedAt, isDegraded: realtimeClient.isDegraded(topic), refresh };
}
