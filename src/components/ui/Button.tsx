import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button variants.
 *
 * Motion policy (see `src/app/globals.css` motion section): the loading
 * spinner uses the shared `--motion-spin` token so all animation durations
 * and easings live in one documented place. Reduced motion is honoured by
 * the global CSS override, which collapses these durations to near-zero.
 */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-500 text-slate-950 hover:bg-emerald-400 focus-visible:outline-emerald-400",
  secondary:
    "bg-slate-800 text-slate-100 hover:bg-slate-700 focus-visible:outline-slate-400",
  ghost:
    "bg-transparent text-slate-200 hover:bg-slate-800/60 focus-visible:outline-slate-400",
  danger:
    "bg-rose-500 text-white hover:bg-rose-400 focus-visible:outline-rose-400",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leftIcon,
    rightIcon,
    className = "",
    children,
    disabled,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-md font-medium",
        "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent"
          style={{ animation: "spin var(--motion-spin) linear infinite" }}
        />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
