"use client";

import type { ReactNode } from "react";

import { useReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { RealtimeViewStatus } from "@/lib/realtime";
import { cn } from "@/lib/cn";
import { Skeleton } from "./Skeleton";

/**
 * State matrix for realtime-backed views (status -> presentation):
 *
 * | status       | content            | indicator                       |
 * |--------------|--------------------|---------------------------------|
 * | empty        | skeleton (no data) | none                            |
 * | live         | data               | "Live"                          |
 * | disconnected | data (kept)        | "Offline — showing last values" |
 * | reconnecting | data (kept)        | "Reconnecting…"                 |
 * | polling      | data               | "Updating periodically"         |
 */
const STATUS_LABEL: Record<Exclude<RealtimeViewStatus, "empty">, string> = {
  live: "Live",
  disconnected: "Offline — showing last values",
  reconnecting: "Reconnecting…",
  polling: "Updating periodically",
};

interface RealtimeViewProps {
  status: RealtimeViewStatus;
  /** Skeleton sized to match the final content so layout does not shift. */
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Renders the skeleton only for a genuinely empty state; once data exists it
 * stays on screen through disconnects/reconnects (no flicker on refresh).
 */
export function RealtimeView({ status, skeleton, children, className }: RealtimeViewProps) {
  const reduced = useReducedMotion();
  if (status === "empty") {
    return (
      <div
        role="status"
        aria-label="Loading"
        aria-busy="true"
        data-reduced-motion={reduced}
        className={className}
      >
        {skeleton}
      </div>
    );
  }
  return (
    <div className={className}>
      <p role="status" className="mb-2 text-[11px] text-pm-text/45" data-status={status}>
        {STATUS_LABEL[status]}
      </p>
      {children}
    </div>
  );
}

/** Block of `lines` text-row skeletons with a fixed height, for card/list bodies. */
export function TextBlockSkeleton({
  lines = 3,
  lineHeight = 14,
}: {
  lines?: number;
  lineHeight?: number;
}) {
  return (
    <div className="flex flex-col gap-2.5" style={{ minHeight: lines * (lineHeight + 10) }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={lineHeight} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}
