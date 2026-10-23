"use client";

import { useEffect, useState } from "react";
import {
  readRealtimeOverride,
  resetRealtimeOverride,
  type RealtimeOverride,
} from "@/lib/realtime/overrides";
import { realtimeClient } from "@/lib/realtime/client";

export function RealtimeOverrideStatus() {
  const [override, setOverride] = useState<RealtimeOverride | null>(null);
  useEffect(() => setOverride(readRealtimeOverride()), []);
  if (!override) return null;
  let endpointLabel = "";
  if (override.endpoint) {
    try {
      endpointLabel = ` · ${new URL(override.endpoint, window.location.href).host}`;
    } catch {
      endpointLabel = " · custom endpoint";
    }
  }
  return (
    <div
      role="status"
      aria-label={`Realtime QA override: ${override.mode}`}
      className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-950 px-3 py-2 text-xs text-amber-100 shadow-lg"
    >
      <span>
        QA realtime: {override.mode}
        {endpointLabel}
      </span>
      <button
        type="button"
        className="underline"
        onClick={() => {
          resetRealtimeOverride();
          realtimeClient.refreshConfiguration();
          setOverride(null);
        }}
      >
        Reset to defaults
      </button>
    </div>
  );
}
