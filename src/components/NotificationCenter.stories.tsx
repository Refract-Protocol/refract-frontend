/**
 * Stories for NotificationCenter (the bell badge + notification panel).
 *
 * Because NotificationCenter derives notifications from several hooks that
 * make real API calls, we render a thin display-only wrapper that accepts
 * notifications directly — matching the component's visual contract without
 * mocking every upstream hook.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { groupNotifications } from '@/lib/notificationGroups';
import type { RefractNotification } from '@/lib/notifications';
import { withMockRealtime } from '@/lib/realtime/testing/mockRealtimeDecorator';

// ---------------------------------------------------------------------------
// Display-only component that mirrors NotificationCenter's render logic but
// accepts `notifications` as a prop so stories stay isolated.
// ---------------------------------------------------------------------------

interface Props {
  notifications: RefractNotification[];
}

const SEVERITY_ICONS: Record<RefractNotification['severity'], string> = {
  info: 'ℹ',
  warning: '⚠',
  success: '✓',
  critical: '⚡',
};

const SEVERITY_COLORS: Record<
  RefractNotification['severity'],
  { bg: string; text: string; border: string }
> = {
  info: { bg: 'bg-pm-violet/10', text: 'text-pm-violet', border: 'border-pm-violet/20' },
  warning: { bg: 'bg-pm-amber/10', text: 'text-pm-amber', border: 'border-pm-amber/20' },
  success: { bg: 'bg-pm-green/10', text: 'text-pm-green', border: 'border-pm-green/20' },
  critical: { bg: 'bg-pm-red/10', text: 'text-pm-red', border: 'border-pm-red/20' },
};

function NotificationCenterDisplay({ notifications }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupNotifications(notifications), [notifications]);
  const unreadCount = notifications.filter((n) => !n.read && !readIds.has(n.id)).length;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((p) => !p)}
        aria-expanded={isOpen}
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-pm-text transition-all hover:border-pm-violet/40 hover:bg-pm-violet/10"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-pm-violet text-[9px] font-extrabold text-white shadow-[0_0_8px_rgba(139,92,246,0.6)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notification Center"
          className="absolute left-0 top-12 z-50 w-[380px] max-w-[calc(100vw-32px)] rounded-xl border border-pm-border bg-pm-bg/95 p-4 shadow-2xl backdrop-blur-xl"
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
          </div>
          <div className="max-h-[360px] overflow-y-auto space-y-2.5 pr-1">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-pm-text/40">
                <span className="mb-2 block text-2xl" aria-hidden="true">🔔</span>
                No notifications right now.
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.key} aria-label={group.key}>
                  <div className="space-y-2.5">
                    {group.items.map((item) => {
                      const colors = SEVERITY_COLORS[item.severity];
                      const icon = SEVERITY_ICONS[item.severity];
                      const isRead = item.read || readIds.has(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`relative flex flex-col gap-1 rounded-lg border p-3 transition-all ${
                            isRead
                              ? 'border-white/5 bg-white/[0.02] opacity-70'
                              : `${colors.border} ${colors.bg} shadow-sm`
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${colors.bg} ${colors.text}`} aria-hidden="true">
                                {icon}
                              </span>
                              <h4 className="text-xs font-bold text-pm-text">{item.title}</h4>
                            </div>
                            {!isRead && (
                              <button
                                type="button"
                                onClick={() => setReadIds((prev) => new Set([...prev, item.id]))}
                                className="text-[10px] text-pm-text/40 hover:text-pm-text"
                              >
                                Mark read
                              </button>
                            )}
                          </div>
                          <p className="text-[11px] leading-relaxed text-pm-text/70">{item.message}</p>
                          {item.href && (
                            <div className="mt-1 flex justify-end">
                              <Link href={item.href} className="text-[11px] font-semibold text-pm-violet hover:underline">
                                View Details →
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof NotificationCenterDisplay> = {
  title: 'Realtime/NotificationCenter',
  component: NotificationCenterDisplay,
  decorators: [withMockRealtime],
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof NotificationCenterDisplay>;

// ---------------------------------------------------------------------------
// No notifications.
// ---------------------------------------------------------------------------
export const Empty: Story = {
  args: { notifications: [] },
};

// ---------------------------------------------------------------------------
// Badge with unread count.
// ---------------------------------------------------------------------------
export const UnreadBadge: Story = {
  args: {
    notifications: [
      {
        id: 'n1',
        type: 'oracle_trigger',
        title: 'Oracle threshold crossed',
        message: 'USDC depeg threshold crossed at 0.94.',
        timestamp: Date.now() - 5_000,
        read: false,
        severity: 'critical',
        href: '/policies',
      },
      {
        id: 'n2',
        type: 'claim_payout',
        title: 'Claim payout received',
        message: 'Your claim for policy P-001 has been disbursed ($250 USDC).',
        timestamp: Date.now() - 60_000,
        read: false,
        severity: 'success',
        href: '/claims',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Mixed read and unread.
// ---------------------------------------------------------------------------
export const MixedReadUnread: Story = {
  args: {
    notifications: [
      {
        id: 'n1',
        type: 'oracle_trigger',
        title: 'Oracle threshold crossed',
        message: 'USDC depeg detected.',
        timestamp: Date.now() - 5_000,
        read: false,
        severity: 'critical',
      },
      {
        id: 'n2',
        type: 'policy_expiring',
        title: 'Policy expiring soon',
        message: 'Policy P-002 expires in 3 days.',
        timestamp: Date.now() - 3_600_000,
        read: true,
        severity: 'warning',
        href: '/policies/P-002',
      },
      {
        id: 'n3',
        type: 'claim_payout',
        title: 'Payout confirmed',
        message: 'Payout of 500 USDC confirmed.',
        timestamp: Date.now() - 7_200_000,
        read: true,
        severity: 'success',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Critical alert (oracle trigger).
// ---------------------------------------------------------------------------
export const CriticalAlert: Story = {
  args: {
    notifications: [
      {
        id: 'nc1',
        type: 'oracle_trigger',
        title: '⚡ USDC depeg — coverage activated',
        message: 'USDC has depegged below 0.94. Your coverage policy has been triggered automatically.',
        timestamp: Date.now() - 2_000,
        read: false,
        severity: 'critical',
        href: '/claims',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Many notifications (overflow / scroll).
// ---------------------------------------------------------------------------
export const Overflow: Story = {
  args: {
    notifications: Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      type: 'policy_expiring' as const,
      title: `Notification ${i + 1}`,
      message: `This is notification number ${i + 1}. It has a medium-length message.`,
      timestamp: Date.now() - i * 60_000,
      read: i % 3 === 0,
      severity: (['info', 'warning', 'success', 'critical'] as const)[i % 4]!,
    })),
  },
};
