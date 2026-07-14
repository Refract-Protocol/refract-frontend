import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

/** Labeled input primitive built on `.pm-input`, with hint/error text and a stable a11y id. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-2 block text-xs text-pm-text/60">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn("pm-input", error && "border-pm-red", className)}
        aria-describedby={cn(hintId, errorId) || undefined}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-[11px] text-pm-text/35">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-[11px] text-pm-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
