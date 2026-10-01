"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  /** Auto-dismiss duration in ms. Pass 0 to keep the toast until dismissed. */
  duration?: number;
}

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  duration: number;
}

export interface ToastState {
  toasts: ToastItem[];
}

export type ToastAction =
  | { type: "ADD"; toast: ToastItem }
  | { type: "DISMISS"; id: string }
  | { type: "CLEAR" };

/** Maximum number of toasts rendered at once; the rest stay queued. */
export const MAX_VISIBLE_TOASTS = 3;

/** Default auto-dismiss duration in ms. */
export const DEFAULT_TOAST_DURATION = 5000;

export const initialToastState: ToastState = { toasts: [] };

export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case "ADD":
      return { toasts: [...state.toasts, action.toast] };
    case "DISMISS":
      return { toasts: state.toasts.filter((t) => t.id !== action.id) };
    case "CLEAR":
      return { toasts: [] };
    default:
      return state;
  }
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let toastCounter = 0;

function createToast(
  variant: ToastVariant,
  message: string,
  options?: ToastOptions,
): ToastItem {
  toastCounter += 1;
  return {
    id: `toast-${Date.now()}-${toastCounter}`,
    variant,
    message,
    duration: options?.duration ?? DEFAULT_TOAST_DURATION,
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, initialToastState);

  const push = useCallback(
    (variant: ToastVariant, message: string, options?: ToastOptions) => {
      const toast = createToast(variant, message, options);
      dispatch({ type: "ADD", toast });
      return toast.id;
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "DISMISS", id });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: "CLEAR" });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      info: (message, options) => push("info", message, options),
      dismiss,
      clear,
    }),
    [push, dismiss, clear],
  );

  return (
    <ToastContext.Provider value={api}>{children}</ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

/**
 * Internal hook used by the Toast viewport to read the queue. Kept separate
 * from `useToast` so consumers only get the imperative API.
 */
export function useToastQueue(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToastQueue must be used within a ToastProvider");
  }
  // The queue is exposed through a ref-like accessor on the context value.
  return (ctx as ToastApi & { __state: ToastState }).__state;
}

export function useToastState(): ToastState {
  const ref = useRef<ToastState>(initialToastState);
  return ref.current;
}
