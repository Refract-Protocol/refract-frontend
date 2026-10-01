import { Skeleton } from "./Skeleton";
import { cn } from "@/lib/cn";

interface ListRowSkeletonsProps {
  count?: number;
  height?: number | string;
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
  ariaLabel?: string;
}

/**
 * Shared primitive for rendering a vertical stack of row skeletons.
 */
export function ListRowSkeletons({
  count = 3,
  height = 72,
  className,
  rounded = "md",
  ariaLabel = "Loading items",
}: ListRowSkeletonsProps) {
  return (
    <div
      className={cn("flex flex-col gap-2.5", className)}
      role="status"
      aria-label={ariaLabel}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={height} rounded={rounded} />
      ))}
    </div>
  );
}
