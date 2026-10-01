"use client";

import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme, mounted } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border border-pm-border bg-white/[0.03] text-sm text-pm-text/70 transition-all hover:border-pm-violet/40 hover:bg-pm-violet/[0.08] hover:text-pm-text ${className ?? ""}`}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {!mounted ? (
        <span className="opacity-0">🌓</span>
      ) : theme === "dark" ? (
        <span aria-hidden="true">☀️</span>
      ) : (
        <span aria-hidden="true">🌙</span>
      )}
    </button>
  );
}
