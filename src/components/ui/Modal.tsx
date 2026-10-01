"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/**
 * Reusable Modal/Dialog primitive.
 *
 * Usage:
 *   const triggerRef = useRef<HTMLButtonElement>(null);
 *   const [open, setOpen] = useState(false);
 *   <button ref={triggerRef} onClick={() => setOpen(true)}>Open</button>
 *   <Modal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     title="About Refract"
 *     initialFocusRef={triggerRef}
 *   >
 *     <p>Modal body content.</p>
 *   </Modal>
 *
 * Renders via a portal, traps focus, restores focus to the trigger on close,
 * closes on Escape/backdrop click (unless `dismissible` is false), locks body
 * scroll while open, and wires up the WAI-ARIA dialog roles.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Element to focus when the modal opens; focus is restored here on close. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** When false, Escape and backdrop click will not dismiss the modal. */
  dismissible?: boolean;
  className?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function getPortalRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let root = document.getElementById("modal-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "modal-root";
    document.body.appendChild(root);
  }
  return root;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  initialFocusRef,
  dismissible = true,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    },
    [dismissible, onClose],
  );

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const target = initialFocusRef?.current ?? panel;
    target?.focus();

    document.addEventListener("keydown", handleKeyDown, true);

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, handleKeyDown, initialFocusRef]);

  if (!open) return null;

  const root = getPortalRoot();
  if (!root) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`pm-panel w-full max-w-md rounded-lg p-6 outline-none ${className ?? ""}`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    root,
  );
}

export default Modal;
