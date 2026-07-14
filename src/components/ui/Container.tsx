import { cn } from "@/lib/cn";

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: "div" | "section" | "main";
}

/** Max-width page container with responsive horizontal padding. */
export function Container({ as = "div", className, children, ...rest }: ContainerProps) {
  const Tag = as;
  return (
    <Tag className={cn("mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-7", className)} {...rest}>
      {children}
    </Tag>
  );
}
