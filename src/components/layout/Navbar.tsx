'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRealtimeHealth } from '@/hooks/useRealtimeHealth';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { NetworkBadge } from '@/components/layout/NetworkBadge';

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/pools', label: 'Pools' },
  { href: '/oracle', label: 'Oracle' },
  { href: '/portfolio', label: 'Portfolio' },
];

type ConnectionState = 'live' | 'connecting' | 'reconnecting' | 'offline';

const CONNECTION_META: Record<
  ConnectionState,
  { label: string; description: string; dotClass: string; textClass: string }
> = {
  live: {
    label: 'Live',
    description: 'Realtime connection is active. Data is streaming live.',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-300',
  },
  connecting: {
    label: 'Connecting',
    description: 'Establishing the realtime connection. Data may be delayed.',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-300',
  },
  reconnecting: {
    label: 'Reconnecting',
    description: 'Realtime connection was lost and is being re-established. Data may be stale.',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-300',
  },
  offline: {
    label: 'Offline',
    description: 'Realtime connection is unavailable. Data shown may be stale.',
    dotClass: 'bg-rose-400',
    textClass: 'text-rose-300',
  },
};

function ConnectionStatusBadge() {
  const { status } = useRealtimeHealth();
  const prefersReducedMotion = usePrefersReducedMotion();

  // Treat unknown/initial states as neutral to avoid SSR mismatch.
  const state: ConnectionState =
    status === 'live' || status === 'connecting' || status === 'reconnecting' || status === 'offline'
      ? status
      : 'connecting';

  const meta = CONNECTION_META[state];
  const shouldPulse = state === 'live' && !prefersReducedMotion;

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`Realtime connection: ${meta.label}. ${meta.description}`}
      title={meta.description}
      className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${meta.dotClass} ${
          shouldPulse ? 'animate-pulse' : ''
        }`}
      />
      <span className={`min-w-[5.5rem] ${meta.textClass}`}>{meta.label}</span>
    </span>
  );
}

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-violet-500/20 bg-violet-950/80 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-violet-100">
          Handsoff
        </Link>

        <ul className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`text-sm transition-colors ${
                    isActive ? 'text-violet-100' : 'text-violet-300 hover:text-violet-100'
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2">
          <ConnectionStatusBadge />
          <NetworkBadge />
        </div>
      </nav>
    </header>
  );
}
