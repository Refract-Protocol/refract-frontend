"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { realtimeClient, type RealtimeUpdate } from "./client";
import { isNewerUpdate, type FreshnessKey } from "./freshness";

type AppliedKey = FreshnessKey;
interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
  lastUpdated: Date | null;
  isRefreshing: boolean;
}
interface Options<T> {
  topic: string;
  flag: string;
  fetcher: (signal: AbortSignal) => Promise<T>;
  fixture?: () => T;
  mapEvent?: (payload: unknown) => T | null;
  mergeEvent?: (payload: unknown, current: T | null) => T | null;
  getRestKey?: (data: T) => Pick<AppliedKey, "sequence" | "timestamp">;
}

/** Shared REST/realtime merge. Realtime wins ties and unverifiable ordering; a newer comparable REST key may advance state. */
export function useRealtimeResource<T>({
  topic,
  flag,
  fetcher,
  fixture,
  mapEvent,
  mergeEvent,
  getRestKey,
}: Options<T>) {
  const enabled = useFeatureFlag(flag);
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    loading: true,
    error: null,
    isFixture: false,
    lastUpdated: null,
    isRefreshing: false,
  });
  const stateRef = useRef(state);
  const appliedRef = useRef<AppliedKey | null>(null);
  const eventGeneration = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingDataRef = useRef<T | null>(null);
  const mountedRef = useRef(false);
  const topicRef = useRef(topic);
  const enabledRef = useRef(enabled);
  const mapEventRef = useRef(mapEvent);
  mapEventRef.current = mapEvent;
  const mergeEventRef = useRef(mergeEvent);
  mergeEventRef.current = mergeEvent;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const fixtureRef = useRef(fixture);
  fixtureRef.current = fixture;
  const getRestKeyRef = useRef(getRestKey);
  getRestKeyRef.current = getRestKey;
  const commit = useCallback((next: ResourceState<T>) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const refresh = useCallback(
    async (manual = true) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const generation = eventGeneration.current;
      commit({
        ...stateRef.current,
        loading: !stateRef.current.data,
        isRefreshing: manual,
        error: null,
      });
      try {
        const data = await fetcherRef.current(controller.signal);
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          generation !== eventGeneration.current
        )
          return;
        const key = { source: "rest" as const, ...(getRestKeyRef.current?.(data) ?? {}) };
        const applied = appliedRef.current;
        if (applied?.source === "realtime" && !isNewerUpdate(applied, key)) return;
        appliedRef.current = key;
        commit({
          data,
          loading: false,
          error: null,
          isFixture: false,
          lastUpdated: new Date(),
          isRefreshing: false,
        });
      } catch (error) {
        if (!mountedRef.current || controller.signal.aborted) return;
        if (fixtureRef.current)
          commit({
            data: fixtureRef.current(),
            loading: false,
            error: null,
            isFixture: true,
            lastUpdated: new Date(),
            isRefreshing: false,
          });
        else
          commit({
            ...stateRef.current,
            loading: false,
            error: "Failed to load data",
            isRefreshing: false,
          });
      }
    },
    [commit]
  );

  useEffect(() => {
    if (topicRef.current !== topic) {
      topicRef.current = topic;
      appliedRef.current = null;
      pendingDataRef.current = null;
      eventGeneration.current += 1;
      commit({
        data: null,
        loading: true,
        error: null,
        isFixture: false,
        lastUpdated: null,
        isRefreshing: false,
      });
    }
    mountedRef.current = true;
    void refresh(false);
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [commit, refresh, topic]);

  useEffect(() => {
    const wasEnabled = enabledRef.current;
    enabledRef.current = enabled;
    if (!enabled) {
      if (wasEnabled) {
        appliedRef.current = null;
        eventGeneration.current += 1;
        void refresh(false);
      }
      return;
    }
    const unsubscribe = realtimeClient.subscribe(topic, (update: RealtimeUpdate) => {
      const data = mergeEventRef.current
        ? mergeEventRef.current(update.payload, pendingDataRef.current ?? stateRef.current.data)
        : mapEventRef.current
          ? mapEventRef.current(update.payload)
          : (update.payload as T);
      if (data == null) return;
      const previous = appliedRef.current;
      if (previous && !isNewerUpdate(previous, { ...update, source: "realtime" })) return;
      eventGeneration.current += 1;
      controllerRef.current?.abort();
      appliedRef.current = {
        sequence: update.sequence,
        timestamp: update.timestamp,
        source: "realtime",
      };
      pendingDataRef.current = data;
      const apply = () => {
        const latest = pendingDataRef.current ?? data;
        pendingDataRef.current = null;
        commit({
          data: latest,
          loading: false,
          error: null,
          isFixture: false,
          lastUpdated: update.timestamp ? new Date(update.timestamp) : new Date(),
          isRefreshing: false,
        });
      };
      if (topic === "protocol.stats" && typeof requestAnimationFrame === "function") {
        if (frameRef.current === null)
          frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            apply();
          });
      } else apply();
    });
    return unsubscribe;
  }, [commit, enabled, refresh, topic]);

  return { ...state, refresh: () => refresh(true) };
}
