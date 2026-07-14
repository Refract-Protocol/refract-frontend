import { forwardRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

interface CommonProps {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  className?: string;
  children: React.ReactNode;
}

type ButtonAsButton = CommonProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

type ButtonAsLink = CommonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const variantClass: Record<Variant, string> = {
  primary: "pm-btn-primary",
  outline: "pm-btn-outline",
  ghost: "pm-btn-ghost",
};

const sizeClass: Record<Size, string> = {
  sm: "pm-btn-sm",
  md: "",
  lg: "pm-btn-lg",
};

/**
 * Shared button primitive built on the existing `.pm-btn*` CSS classes.
 * Renders a <button> by default, or a Next.js <Link> when `href` is passed.
 */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", block, loading, className, children, ...rest }, ref) {
    const classes = cn("pm-btn", variantClass[variant], sizeClass[size], block && "pm-btn-block", className);

    if ("href" in rest && rest.href !== undefined) {
      const { href, ...anchorRest } = rest as ButtonAsLink;
      return (
        <Link
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={classes}
          aria-busy={loading || undefined}
          {...anchorRest}
        >
          {loading ? <ButtonSpinner /> : null}
          {children}
        </Link>
      );
    }

    const { disabled, ...buttonRest } = rest as ButtonAsButton;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...buttonRest}
      >
        {loading ? <ButtonSpinner /> : null}
        {children}
      </button>
    );
  }
);

function ButtonSpinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 13,
        height: 13,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.35)",
        borderTopColor: "#fff",
        animation: "spin 0.6s linear infinite",
        display: "inline-block",
      }}
    />
  );
}
