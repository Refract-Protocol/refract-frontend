"use client";
import React, { Profiler, type ProfilerOnRenderCallback } from "react";

export const shouldProfileRealtime = (
  environment = process.env.NODE_ENV,
  enabledFlag = process.env.NEXT_PUBLIC_REALTIME_PROFILER,
) => environment !== "production" && enabledFlag === "1";
const enabled = shouldProfileRealtime();
const totals = new Map<string, { commits: number; durations: number[] }>();
const onRender: ProfilerOnRenderCallback = (topic, _phase, actualDuration) => {
  const item = totals.get(topic) ?? { commits: 0, durations: [] };
  item.commits += 1; item.durations.push(actualDuration); totals.set(topic, item);
  if (enabled && typeof window !== "undefined") {
    (window as Window & { __REFRACT_REALTIME_PROFILE__?: unknown }).__REFRACT_REALTIME_PROFILE__ = getRealtimeProfile();
  }
};
export function RealtimeProfiler({ topic, children }: { topic: string; children: React.ReactNode }) {
  return enabled ? React.createElement(Profiler, { id: topic, onRender }, children) : React.createElement(React.Fragment, null, children);
}
export function getRealtimeProfile() {
  return Object.fromEntries([...totals].map(([topic, result]) => [topic, { commits: result.commits, durations: [...result.durations] }]));
}
export function resetRealtimeProfile() { totals.clear(); }
