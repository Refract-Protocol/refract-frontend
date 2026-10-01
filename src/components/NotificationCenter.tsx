"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useNotifications } from "@/hooks/useNotifications";
import type { RefractNotification } from "@/lib/notifications";

const SEVERITY_ICONS: Record<RefractNotification["severity"], string> = {
  info: "ℹ",
  warning: "⚠",
  success: "✓",
  critical: "⚡",
};

const SEVERITY_COLORS: Record<RefractNotification["severity"], { bg: string; text: string; border: string }> = {
  info: { bg: "bg-pm-violet/10", text: "text-pm-violet", border: "border-pm-violet/20" },
  warning: { bg: "bg-pm-amber/10", text: "text-pm-amber", border: "border-pm-amber/20" },
  success: { bg: "bg-pm-green/10", text: "text-pm-green", border: "border-pm-green/20" },
  critical: { bg: "bg-pm-red/10", text: "text-pm-red", border: "border-pm-red/20" },
};

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ""}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-pm-text transition-all hover:border-pm-violet/40 hover:bg-pm-violet/10"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-pm-violet text-[9px] font-extrabold text-white shadow-[0_0_8px_rgba(139,92,246,0.6)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notification Center"
          className="absolute right-0 top-12 z-50 w-[340px] max-w-[calc(100vw-32px)] rounded-xl border border-pm-border bg-pm-bg/95 p-4 shadow-2xl backdrop-blur-xl animate-fade-up sm:w-[380px]"
        >
          <div className="mb-3 flex items-center justify-between border-b border-pm-border pb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-pm-text">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-pm-violet/20 px-2 py-0.5 text-[10px] font-bold text-pm-violet">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-[11px] font-medium text-pm-violet hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto space-y-2.5 pr-1">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-pm-text/40">
                <span className="mb-2 block text-2xl" aria-hidden="true">🔔</span>
                No notifications right now. You&apos;re all caught up!
              </div>
            ) : (
              notifications.map((item) => {
                const colors = SEVERITY_COLORS[item.severity];
                const icon = SEVERITY_ICONS[item.severity];

                return (
                  <div
                    key={item.id}
                    className={`relative flex flex-col gap-1 rounded-lg border p-3 transition-all ${
                      item.read
                        ? "border-white/5 bg-white/[0.02] opacity-70"
                        : `${colors.border} ${colors.bg} shadow-sm`
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${colors.bg} ${colors.text}`}
                          aria-hidden="true"
                        >
                          {icon}
                        </span>
                        <h4 className="text-xs font-bold text-pm-text">{item.title}</h4>
                      </div>
                      {!item.read && (
                        <button
                          type="button"
                          onClick={() => markAsRead(item.id)}
                          className="text-[10px] text-pm-text/40 hover:text-pm-text"
                          title="Mark as read"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-pm-text/70">{item.message}</p>
                    {item.href && (
                      <div className="mt-1 flex justify-end">
                        <Link
                          href={item.href}
                          onClick={() => {
                            markAsRead(item.id);
                            setIsOpen(false);
                          }}
                          className="text-[11px] font-semibold text-pm-violet hover:underline"
                        >
                          View Details →
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
