'use client';

import { useReportWebVitals } from 'next/web-vitals';

/**
 * Core Web Vitals metric names we care about for regression detection.
 * LCP = Largest Contentful Paint, INP = Interaction to Next Paint
 * (the successor to FID), CLS = Cumulative Layout Shift.
 */
export type WebVitalName = 'LCP' | 'INP' | 'FID' | 'CLS' | 'TTFB' | 'FCP';

export interface WebVitalMetric {
  id: string;
  name: WebVitalName | string;
  value: number;
  delta: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
  navigationType?: string;
}

/**
 * Shape of the event dispatched to the pluggable analytics sink. Kept
 * vendor-agnostic so it can be forwarded to whatever analytics pipeline
 * (e.g. the Category 3 abstraction) is wired up, or simply logged.
 */
export interface WebVitalsEvent {
  type: 'web-vitals';
  name: string;
  value: number;
  delta: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
  id: string;
  navigationType?: string;
  timestamp: number;
}

/**
 * Pluggable sink. Consumers can override this to forward metrics to a
 * specific analytics vendor without coupling this module to it.
 */
export type WebVitalsReporter = (event: WebVitalsEvent) => void;

/**
 * Default reporter: a negligible-overhead console log. Intentionally
 * decoupled from any analytics vendor so it can be swapped out later.
 */
export const defaultReporter: WebVitalsReporter = (event) => {
  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug('[web-vitals]', event.name, event.value, event.rating ?? '');
  }
};

/**
 * Format a raw Next.js web-vitals metric into the vendor-agnostic event
 * shape dispatched to the reporter. Exported for unit testing.
 */
export function formatWebVital(
  metric: WebVitalMetric,
  now: number = Date.now(),
): WebVitalsEvent {
  return {
    type: 'web-vitals',
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
    timestamp: now,
  };
}

/**
 * Dispatch a metric through the provided reporter, guarding against a
 * misbehaving sink so profiling/reporting never breaks the app.
 */
export function reportWebVital(
  metric: WebVitalMetric,
  reporter: WebVitalsReporter = defaultReporter,
  now: number = Date.now(),
): WebVitalsEvent {
  const event = formatWebVital(metric, now);
  try {
    reporter(event);
  } catch {
    // Swallow reporter errors: instrumentation must never regress the app.
  }
  return event;
}

interface WebVitalsProps {
  reporter?: WebVitalsReporter;
}

/**
 * Client component that wires Next.js's built-in `useReportWebVitals`
 * into the pluggable reporter above. Mounted once from the root layout.
 *
 * Overhead is negligible: the hook only fires on metric completion and
 * the default reporter is a single console.debug call.
 */
export default function WebVitals({ reporter = defaultReporter }: WebVitalsProps) {
  useReportWebVitals((metric) => {
    reportWebVital(metric as WebVitalMetric, reporter);
  });

  return null;
}
