"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Placement of the tooltip bubble relative to its trigger.
 */
export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** Tooltip body. Plain text is recommended (WCAG 1.4.13). */
  content: ReactNode;
  /** Preferred placement; flips automatically when clipped by the viewport. */
  placement?: TooltipPlacement;
  /** Delay in ms before showing on hover/focus. */
  delay?: number;
  /** The focusable trigger element. */
  children: ReactNode;
  className?: string;
}

const GAP = 8;
const LONG_PRESS_MS = 450;

/**
 * Compute the bubble offset for a placement, flipping to the opposite side
 * when the bubble would overflow the viewport.
 */
function resolvePosition(
  trigger: DOMRect,
  bubble: DOMRect,
  placement: TooltipPlacement,
): { top: number; left: number; placement: TooltipPlacement } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let resolved = placement;

  if (placement === "top" && trigger.top - bubble.height - GAP < 0) resolved = "bottom";
  else if (placement === "bottom" && trigger.bottom + bubble.height + GAP > vh) resolved = "top";
  else if (placement === "left" && trigger.left - bubble.width - GAP < 0) resolved = "right";
  else if (placement === "right" && trigger.right + bubble.width + GAP > vw) resolved = "left";

  let top = 0;
  let left = 0;
  switch (resolved) {
    case "top":
      top = trigger.top - bubble.height - GAP;
      left = trigger.left + trigger.width / 2 - bubble.width / 2;
      break;
    case "bottom":
      top = trigger.bottom + GAP;
      left = trigger.left + trigger.width / 2 - bubble.width / 2;
      break;
    case "left":
      top = trigger.top + trigger.height / 2 - bubble.height / 2;
      left = trigger.left - bubble.width - GAP;
      break;
    case "right":
      top = trigger.top + trigger.height / 2 - bubble.height / 2;
      left = trigger.right + GAP;
      break;
  }

  // Clamp horizontally so the bubble never leaves the viewport.
  left = Math.max(GAP, Math.min(left, vw - bubble.width - GAP));
  top = Math.max(GAP, Math.min(top, vh - bubble.height - GAP));

  return { top, left, placement: resolved };
}

/**
 * Accessible tooltip primitive.
 *
 * Shows on hover, focus and long-press; hides on blur, mouse-leave, Escape and
 * any outside tap. The bubble is wired to the trigger via `aria-describedby`
 * and carries `role="tooltip"`. Placement flips automatically when clipped.
 */
export function Tooltip({
  content,
  placement = "top",
  delay = 120,
  children,
  className,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: TooltipPlacement }>({
    top: 0,
    left: 0,
    placement,
  });

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(
    (immediate = false) => {
      clearTimer();
      if (immediate) setOpen(true);
      else timer.current = setTimeout(() => setOpen(true), delay);
    },
    [clearTimer, delay],
  );

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  // Reposition whenever the bubble opens or the viewport changes.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const update = () => {
      setPos(resolvePosition(trigger.getBoundingClientRect(), bubble.getBoundingClientRect(), placement));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, placement]);

  // Escape dismisses; outside pointer/tap dismisses (touch has no hover).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || bubbleRef.current?.contains(target)) return;
      hide();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, hide]);

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <span
      ref={triggerRef}
      className={cn("pm-tooltip-trigger", className)}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => show()}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onTouchStart={() => show()}
      onTouchEnd={clearTimer}
      onTouchCancel={hide}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      {open && (
        <div
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className="pm-tooltip pm-panel"
          data-placement={pos.placement}
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={() => show(true)}
          onMouseLeave={hide}
        >
          {content}
        </div>
      )}
    </span>
  );
}

export interface InfoButtonProps {
  /** Explanation shown inside the tooltip. */
  content: ReactNode;
  /** Accessible name for the trigger, e.g. "What is PPS share price?". */
  label: string;
  placement?: TooltipPlacement;
  className?: string;
}

/**
 * Small `?` trigger with an accessible name, for use beside metric labels.
 */
export function InfoButton({ content, label, placement = "top", className }: InfoButtonProps) {
  return (
    <Tooltip content={content} placement={placement} className={className}>
      <button type="button" className="pm-info-btn" aria-label={label}>
        <span aria-hidden="true">?</span>
      </button>
    </Tooltip>
  );
}
