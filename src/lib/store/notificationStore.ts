/**
 * App-wide transient notification queue.
 *
 * Owns notification identity, ordering, deduplication, lifetime and
 * dismissal so any feature can raise a message without inventing its own
 * mechanism. Framework-agnostic and SSR-safe: no `document` access at
 * module scope, and all timers are tracked so they can be cleared on
 * teardown.
 *
 * The visual Toast component is a separate design-system concern; this
 * store deliberately has no dependency on it.
 */

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface Notification {
  id: string;
  tone: NotificationTone;
  title: string;
  description?: string;
  action?: NotificationAction;
  createdAt: number;
  /** Auto-dismiss delay in ms. `null` means the entry never auto-dismisses. */
  duration: number | null;
  dedupeKey?: string;
}

export interface NotifyInput {
  tone?: NotificationTone;
  title: string;
  description?: string;
  action?: NotificationAction;
  /** Auto-dismiss delay in ms. Defaults per tone; errors never auto-dismiss. */
  duration?: number | null;
  dedupeKey?: string;
}

/** Maximum number of entries retained in the queue. */
export const MAX_NOTIFICATIONS = 5;

/** Window (ms) within which an identical `dedupeKey` updates in place. */
export const DEDUPE_WINDOW_MS = 5000;

const DEFAULT_DURATION_MS = 5000;

let notifications: Notification[] = [];
let seq = 0;

const listeners = new Set<() => void>();

/** Per-entry auto-dismiss timers, kept outside React state so re-renders never restart them. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Remaining lifetime per entry, used to pause/resume across visibility changes. */
const remaining = new Map<string, number>();
/** Timestamp at which each entry's timer was last (re)started. */
const startedAt = new Map<string, number>();

let visibilityBound = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function setNotifications(next: Notification[]): void {
  notifications = next;
  emit();
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  remaining.delete(id);
  startedAt.delete(id);
}

function clearAllTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  remaining.clear();
  startedAt.clear();
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function startTimer(entry: Notification): void {
  if (entry.duration === null) return;
  if (isHidden()) {
    // Defer until the document becomes visible again.
    remaining.set(entry.id, entry.duration);
    return;
  }
  const started = Date.now();
  startedAt.set(entry.id, started);
  remaining.set(entry.id, entry.duration);
  const timer = setTimeout(() => {
    timers.delete(entry.id);
    remaining.delete(entry.id);
    startedAt.delete(entry.id);
    dismiss(entry.id);
  }, entry.duration);
  timers.set(entry.id, timer);
}

function pauseTimers(): void {
  const now = Date.now();
  for (const entry of notifications) {
    const timer = timers.get(entry.id);
    if (timer === undefined) continue;
    clearTimeout(timer);
    timers.delete(entry.id);
    const started = startedAt.get(entry.id) ?? now;
    const left = (remaining.get(entry.id) ?? entry.duration ?? 0) - (now - started);
    remaining.set(entry.id, Math.max(0, left));
    startedAt.delete(entry.id);
  }
}

function resumeTimers(): void {
  for (const entry of notifications) {
    if (entry.duration === null) continue;
    if (timers.has(entry.id)) continue;
    const left = remaining.get(entry.id) ?? entry.duration;
    if (left <= 0) {
      dismiss(entry.id);
      continue;
    }
    const started = Date.now();
    startedAt.set(entry.id, started);
    const timer = setTimeout(() => {
      timers.delete(entry.id);
      remaining.delete(entry.id);
      startedAt.delete(entry.id);
      dismiss(entry.id);
    }, left);
    timers.set(entry.id, timer);
  }
}

function onVisibilityChange(): void {
  if (isHidden()) pauseTimers();
  else resumeTimers();
}

function bindVisibility(): void {
  if (visibilityBound) return;
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  visibilityBound = true;
}

function unbindVisibility(): void {
  if (!visibilityBound) return;
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  visibilityBound = false;
}

function resolveDuration(input: NotifyInput): number | null {
  if (input.duration !== undefined) return input.duration;
  // Error-tone notifications must never auto-dismiss without an explicit duration.
  if (input.tone === "error") return null;
  return DEFAULT_DURATION_MS;
}

/**
 * Evict the oldest non-error entry to make room. Errors are never dropped
 * while unread; if the queue is entirely errors we drop the oldest error as
 * a last resort so the queue stays bounded.
 */
function evictForRoom(): void {
  while (notifications.length >= MAX_NOTIFICATIONS) {
    const index = notifications.findIndex((n) => n.tone !== "error");
    const target = index === -1 ? 0 : index;
    const [removed] = notifications.splice(target, 1);
    if (removed) clearTimer(removed.id);
  }
}

/**
 * Raise a notification. Identical `dedupeKey` within `DEDUPE_WINDOW_MS`
 * updates the existing entry and resets its timer instead of enqueuing a
 * duplicate.
 */
export function notify(input: NotifyInput): string {
  bindVisibility();
  const now = Date.now();

  if (input.dedupeKey) {
    const existing = notifications.find(
      (n) => n.dedupeKey === input.dedupeKey && now - n.createdAt <= DEDUPE_WINDOW_MS,
    );
    if (existing) {
      clearTimer(existing.id);
      const updated: Notification = {
        ...existing,
        tone: input.tone ?? existing.tone,
        title: input.title,
        description: input.description,
        action: input.action,
        createdAt: now,
        duration: resolveDuration(input),
      };
      setNotifications(notifications.map((n) => (n.id === existing.id ? updated : n)));
      startTimer(updated);
      return updated.id;
    }
  }

  const entry: Notification = {
    id: `n_${now.toString(36)}_${(seq++).toString(36)}`,
    tone: input.tone ?? "info",
    title: input.title,
    description: input.description,
    action: input.action,
    createdAt: now,
    duration: resolveDuration(input),
    dedupeKey: input.dedupeKey,
  };

  const next = [...notifications, entry];
  notifications = next;
  evictForRoom();
  emit();
  startTimer(entry);
  return entry.id;
}

/** Remove a single notification by id. */
export function dismiss(id: string): void {
  clearTimer(id);
  const next = notifications.filter((n) => n.id !== id);
  if (next.length === notifications.length) return;
  setNotifications(next);
}

/** Remove every notification and clear all timers. */
export function dismissAll(): void {
  clearAllTimers();
  unbindVisibility();
  if (notifications.length === 0) return;
  setNotifications([]);
}

/** Current queue snapshot. */
export function getNotifications(): Notification[] {
  return notifications;
}

/** Subscribe to queue changes; returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test/teardown helper: clears the queue and every timer without leaving
 * listeners or visibility handlers behind.
 */
export function resetNotificationStore(): void {
  clearAllTimers();
  unbindVisibility();
  listeners.clear();
  notifications = [];
  seq = 0;
}
