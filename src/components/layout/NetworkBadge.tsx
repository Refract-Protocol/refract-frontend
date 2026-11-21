import { useRealtimeHealth } from '@/hooks/useRealtimeHealth';

const HEALTH_STYLES: Record<string, { dot: string; label: string }> = {
  connecting: {
    dot: 'bg-gray-400',
    label: 'Connecting',
  },
  healthy: {
    dot: 'bg-green-500',
    label: 'Connected',
  },
  degraded: {
    dot: 'bg-yellow-500',
    label: 'Degraded',
  },
  offline: {
    dot: 'bg-red-500',
    label: 'Offline',
  },
};

export function NetworkBadge() {
  const health = useRealtimeHealth();
  const style = HEALTH_STYLES[health] ?? HEALTH_STYLES.connecting;

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700"
      role="status"
      aria-live="polite"
    >
      <span
        className={`h-2 w-2 rounded-full ${style.dot}`}
        aria-hidden="true"
      />
      <span>{style.label}</span>
    </div>
  );
}
