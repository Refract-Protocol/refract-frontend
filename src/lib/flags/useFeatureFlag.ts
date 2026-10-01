"use client";

import { useEffect, useState } from "react";
import { DEFAULT_FLAGS, FLAGS_CACHE_TTL_MS, FLAGS_ENDPOINT, readLocalOverride, type FlagsDocument } from "./flagsConfig";

let cache: { flags: Record<string, boolean>; fetchedAt: number } | null = null;
let inflight: Promise<Record<string, boolean>> | null = null;

async function loadFlags(): Promise<Record<string, boolean>> {
  const override = readLocalOverride();
  if (override) return { ...DEFAULT_FLAGS, ...override };

  if (cache && Date.now() - cache.fetchedAt < FLAGS_CACHE_TTL_MS) return cache.flags;
  if (inflight) return inflight;

  inflight = fetch(FLAGS_ENDPOINT)
    .then((res) => (res.ok ? (res.json() as Promise<FlagsDocument>) : Promise.reject(new Error("flags fetch failed"))))
    .then((doc) => {
      const flags = { ...DEFAULT_FLAGS, ...doc.flags };
      cache = { flags, fetchedAt: Date.now() };
      return flags;
    })
    .catch(() => DEFAULT_FLAGS)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Resolves a feature flag from a session-cached remote JSON document, with a
 * safe (off) default if the source is unreachable, and a local override for
 * development via NEXT_PUBLIC_FLAGS_OVERRIDE.
 */
export function useFeatureFlag(key: string): boolean {
  const [enabled, setEnabled] = useState(() => cache?.flags[key] ?? DEFAULT_FLAGS[key] ?? false);

  useEffect(() => {
    let cancelled = false;
    loadFlags().then((flags) => {
      if (!cancelled) setEnabled(flags[key] ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return enabled;
}
