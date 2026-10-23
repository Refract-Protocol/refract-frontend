"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function Navbar({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-white/10 bg-pm-bg/90">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6"
      >
        <Link href="/" className="font-semibold tracking-tight text-white">
          Refract
        </Link>
        <div className="flex items-center gap-5 text-sm text-white/80">
          <Link href="/cover" className="hover:text-white">
            Get Coverage
          </Link>
          <Link href="/provide" className="hover:text-white">
            Provide Capital
          </Link>
          {right}
        </div>
      </nav>
    </header>
  );
}
