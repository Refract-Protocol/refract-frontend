"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Toast, type ToastTone } from "./Toast";

/** Options accepted by {@link useToast}'s `toast` function. */
export interface ToastOptions {
  /** Short headline for the notification. */
  title: string;
  /** Optional supporting copy. */
  description?: ReactNode;
  /** Colour tone; `danger` is announced assertively. */
  tone?: ToastTone;
  /** Auto-dismiss delay in ms. Pass `0` to keep the toast until dismissed. */
  duration?: number;
  /** Optional action element (e.g. a retry button). */
  action?: ReactNode;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 5000;

/**
 * Provides a stacking toast system with a single accessible live region.
 *
 * Mount once near the app root (alongside `WalletProvider`). Consumers call
 * {@link useToast} to enqueue notifications. Identical toasts coalesce so the
 * live region is not spammed, timers pause on hover/focus, and all timers are
 * cleared on unmount to avoid state updates after unmount.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const schedule = useCallback(
    (id: number, duration: number) => {
      if (duration <= 0) return;
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  const toast = useCallback(
    ({ title, description, tone = "neutral", duration = DEFAULT_DURATION, action }: ToastOptions) => {
      const id = (idRef.current += 1);
      setToasts((current) => {
        const duplicate = current.find(
          (item) => item.title === title && item.tone === tone,
        );
        if (duplicate) {
          schedule(duplicate.id, duration);
          return current;
        }
        schedule(id, duration);
        return [...current, { id, title, description, tone, duration, action }];
      });
      return id;
    },
    [schedule],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  const polite = toasts.filter((item) => item.tone !== "danger");
  const assertive = toasts.filter((item) => item.tone === "danger");

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {polite.map((item) => (
          <ToastItem key={item.id} record={item} onDismiss={dismiss} onSchedule={schedule} />
        ))}
      </div>
      <div
        aria-live="assertive"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {assertive.map((item) => (
          <ToastItem key={item.id} record={item} onDismiss={dismiss} onSchedule={schedule} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  record,
  onDismiss,
  onSchedule,
}: {
  record: ToastRecord;
  onDismiss: (id: number) => void;
  onSchedule: (id: number, duration: number) => void;
}) {
  const duration = record.duration ?? DEFAULT_DURATION;
  const paused = useRef(false);

  const pause = useCallback(() => {
    paused.current = true;
  }, []);

  const resume = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    onSchedule(record.id, duration);
  }, [duration, onSchedule, record.id]);

  return (
    <div
      className="pointer-events-auto motion-safe:animate-[toast-in_150ms_ease-out]"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <Toast
        title={record.title}
        description={record.description}
        tone={record.tone}
        action={record.action}
        onDismiss={() => onDismiss(record.id)}
      />
    </div>
  );
}

/**
 * Access the toast system. Must be used within a {@link ToastProvider}.
 *
 * @returns `{ toast, dismiss }` where `toast(options)` enqueues a notification
 * and returns its id.
 * @throws If called outside of a `ToastProvider`.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
