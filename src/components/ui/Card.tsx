import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type CardPadding = "none" | "sm" | "stat" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

const paddingClasses: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-3",
  stat: "p-[18px]",
  md: "p-5",
  lg: "p-8",
};

export function Card({
  padding = "md",
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-pm-border bg-pm-surface",
        paddingClasses[padding],
        className,
      )}
      {...props}
    />
  );
}
