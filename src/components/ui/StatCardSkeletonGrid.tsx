import { Card } from "./Card";
import { Skeleton } from "./Skeleton";
import { cn } from "@/lib/cn";

interface StatCardSkeletonGridProps {
  count?: number;
  columns?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Shared primitive for rendering a responsive grid of stat card skeletons.
 */
export function StatCardSkeletonGrid({
  count = 4,
  columns = "grid-cols-2 sm:grid-cols-4",
  className,
  ariaLabel = "Loading statistics",
}: StatCardSkeletonGridProps) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={cn("grid gap-3.5", columns, className)}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} padding="sm" className="!p-[18px]">
          <Skeleton height={11} width={70} className="mb-2.5" />
          <Skeleton height={22} width={90} />
        </Card>
      ))}
    </div>
  );
}
