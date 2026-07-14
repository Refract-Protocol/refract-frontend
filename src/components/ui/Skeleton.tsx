import { cn } from "@/lib/cn";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  rounded?: "sm" | "md" | "full";
}

const roundedClass: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
  sm: "rounded-md",
  md: "rounded-lg",
  full: "rounded-full",
};

/** Shimmering placeholder block for loading states — built on `.pm-skeleton`. */
export function Skeleton({ width, height = 16, rounded = "sm", className, style, ...rest }: SkeletonProps) {
  return (
    <div
      className={cn("pm-skeleton", roundedClass[rounded], className)}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}
