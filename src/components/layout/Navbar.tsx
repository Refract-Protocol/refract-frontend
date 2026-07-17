"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const NAV_LINKS = [
  { label: "Coverage", href: "/cover" },
  { label: "Provide Capital", href: "/provide" },
  { label: "Dashboard", href: "/dashboard" },
];

interface NavbarProps {
  /** Right-aligned slot, typically the wallet connect button. */
  right?: React.ReactNode;
}

export function Navbar({ right }: NavbarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [menuOpen]);

  return (
    <nav
      className="sticky top-0 z-50 border-b border-pm-border bg-[rgba(7,5,15,0.85)] backdrop-blur-xl"
      aria-label="Primary"
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-7">
        <div className="flex items-center gap-9">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Refract home">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                background: "linear-gradient(135deg,#8b5cf6,#5b21b6)",
                boxShadow: "0 0 16px rgba(139,92,246,0.4)",
              }}
            >
              <span className="text-base text-white" aria-hidden="true">⬡</span>
            </div>
            <span className="font-display text-lg font-extrabold tracking-tight text-pm-text">Refract</span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "text-sm font-medium transition-colors",
                    active ? "text-pm-violet" : "text-pm-text/55 hover:text-pm-text"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="hidden items-center gap-3 md:flex">{right}</div>

        <button
          ref={menuButtonRef}
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-pm-border text-pm-text md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span aria-hidden="true" className="relative block h-3.5 w-4">
            <span
              className={cn(
                "absolute left-0 top-0 h-[1.5px] w-4 bg-current transition-transform",
                menuOpen && "translate-y-[6.5px] rotate-45"
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-1/2 h-[1.5px] w-4 -translate-y-1/2 bg-current transition-opacity",
                menuOpen && "opacity-0"
              )}
            />
            <span
              className={cn(
                "absolute left-0 bottom-0 h-[1.5px] w-4 bg-current transition-transform",
                menuOpen && "-translate-y-[6.5px] -rotate-45"
              )}
            />
          </span>
        </button>
      </div>

      {menuOpen && (
        <div
          id="mobile-nav"
          className="border-t border-pm-border bg-pm-bg px-4 pb-5 pt-3 md:hidden animate-fade-up"
        >
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    "rounded-md px-3 py-2.5 text-sm font-medium",
                    active ? "bg-pm-violet/10 text-pm-violet" : "text-pm-text/70"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          {right && <div className="mt-4 flex flex-col gap-2 border-t border-pm-border pt-4">{right}</div>}
        </div>
      )}
    </nav>
  );
}
