"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const sizeClasses: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

/**
 * Accessible modal dialog primitive. Renders through a portal, traps focus
 * while open, restores focus to the trigger on close, locks body scroll,
 * and closes on Escape or backdrop click. Styling builds on the shared
 * `.pm-panel` class; entry/exit animation is disabled under reduced motion.
 */
export interface DialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Called when the dialog requests to open or close. */
  onOpenChange: (open: boolean) => void;
  /** Accessible title, wired to `aria-labelledby`. */
  title: ReactNode;
  /** Optional description, wired to `aria-describedby`. */
  description?: ReactNode;
  /** Panel width preset. */
  size?: "sm" | "md" | "lg";
  /** Optional footer slot rendered below the body. */
  footer?: ReactNode;
  /** Dialog body content. */
  children?: ReactNode;
  /** Extra classes applied to the panel. */
  className?: string;
}

export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog(
  { open, onOpenChange, title, description, size = "md", footer, children, className },
  ref,
) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Move focus into the dialog on open and restore it on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape closes; Tab and Shift+Tab cycle focus within the dialog.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 xs:items-center xs:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={setRefs}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "pm-panel w-full outline-none",
          sizeClasses[size],
          "rounded-b-none xs:rounded-b-lg",
          !reducedMotion && "animate-fade-up",
          className,
        )}
      >
        <div className="border-b border-pm-border px-5 py-4">
          <h2 id={titleId} className="text-[15px] font-semibold text-pm-text">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-[13px] text-pm-text/60">
              {description}
            </p>
          )}
        </div>
        {children && <div className="px-5 py-4 text-[13px] text-pm-text/80">{children}</div>}
        {footer && (
          <div className="flex justify-end gap-2 border-t border-pm-border px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
});
