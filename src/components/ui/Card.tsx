import { cn } from "@/lib/cn";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padding?: "sm" | "md" | "lg" | "none";
}

const paddingClass: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-7",
};

/** Panel primitive built on `.pm-panel`. Optional hover-lift for clickable cards. */
export function Card({ hover, padding = "md", className, children, ...rest }: CardProps) {
  return (
    <div className={cn("pm-panel", paddingClass[padding], hover && "pm-card-hover", className)} {...rest}>
      {children}
    </div>
  );
}
