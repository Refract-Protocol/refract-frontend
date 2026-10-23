/**
 * OpenTelemetry-compatible instrumentation for the realtime WebSocket client.
 *
 * Closes #237: Emits spans and counters/duration histograms around connection
 * attempts, subscribes, frame handling, reconnects, and fallback activations.
 * Gives the team aggregate, backend-correlatable visibility rather than the
 * per-session view the health observability work provides.
 *
 * ## Design decisions
 *
 * 1. **No hard OTel SDK dependency in production.** The `@opentelemetry/api`
 *    package is the zero-overhead facade that only performs real work when an
 *    SDK is registered. We call `trace.getTracer()` and `metrics.getMeter()`
 *    at module initialisation; both return no-op implementations when no SDK
 *    is bootstrapped, so the instrumentation is always safe to import.
 *
 * 2. **Pluggable fallback.** If `@opentelemetry/api` is not installed at all
 *    (it is currently only an optional peer dep of vitest), `RealtimeTracer`
 *    falls back to a lightweight no-op shim so the build never fails.
 *
 * 3. **Counter + histogram names** follow OTel semantic-conventions style:
 *      `realtime.connect.attempts`     (counter)
 *      `realtime.connect.errors`       (counter)
 *      `realtime.reconnects`           (counter)
 *      `realtime.messages`             (counter,  attributes: topic)
 *      `realtime.subscribe.active`     (upDownCounter, attributes: topic)
 *      `realtime.fallback.activations` (counter,  attributes: reason)
 *      `realtime.session.duration_ms`  (histogram, recorded on disconnect)
 *
 * 4. **Span names** (all under the `realtime` scope):
 *      `realtime connect`     – wraps open→close lifecycle
 *      `realtime message`     – wraps single message dispatch (short)
 *
 * To bootstrap OTel, install `@opentelemetry/sdk-web` (or node equivalent)
 * and call `sdk.start()` before mounting the React tree. This file does not
 * need to change.
 */

// ---------------------------------------------------------------------------
// OTel API — optional import with zero-runtime-cost fallback
// ---------------------------------------------------------------------------

/** Minimal subset of the OTel Tracer API we need. */
interface OtelSpan {
  end(): void;
  setStatus(s: { code: number }): void;
  recordException(e: unknown): void;
  setAttribute(key: string, value: string | number | boolean): void;
}
interface OtelTracer {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> }
  ): OtelSpan;
}
interface OtelCounter {
  add(value: number, attributes?: Record<string, string | number | boolean>): void;
}
interface OtelUpDownCounter {
  add(value: number, attributes?: Record<string, string | number | boolean>): void;
}
interface OtelHistogram {
  record(value: number, attributes?: Record<string, string | number | boolean>): void;
}
interface OtelMeter {
  createCounter(name: string, options?: { description?: string }): OtelCounter;
  createUpDownCounter(name: string, options?: { description?: string }): OtelUpDownCounter;
  createHistogram(name: string, options?: { description?: string; unit?: string }): OtelHistogram;
}

/** No-op shim used when @opentelemetry/api is absent or no SDK is registered. */
const NOOP_SPAN: OtelSpan = {
  end: () => undefined,
  setStatus: () => undefined,
  recordException: () => undefined,
  setAttribute: () => undefined,
};
const NOOP_TRACER: OtelTracer = {
  startSpan: () => NOOP_SPAN,
};
const NOOP_COUNTER: OtelCounter = { add: () => undefined };
const NOOP_UP_DOWN: OtelUpDownCounter = { add: () => undefined };
const NOOP_HISTOGRAM: OtelHistogram = { record: () => undefined };
const NOOP_METER: OtelMeter = {
  createCounter: () => NOOP_COUNTER,
  createUpDownCounter: () => NOOP_UP_DOWN,
  createHistogram: () => NOOP_HISTOGRAM,
};

function tryGetTracer(name: string, version: string): OtelTracer {
  try {
    // Dynamic require — only resolves if @opentelemetry/api is installed.
    const otel = require("@opentelemetry/api") as {
      trace: { getTracer(name: string, version?: string): OtelTracer };
    };
    return otel.trace.getTracer(name, version);
  } catch {
    return NOOP_TRACER;
  }
}

function tryGetMeter(name: string, version: string): OtelMeter {
  try {
    const otel = require("@opentelemetry/api") as {
      metrics: { getMeter(name: string, version?: string): OtelMeter };
    };
    return otel.metrics.getMeter(name, version);
  } catch {
    return NOOP_METER;
  }
}

// ---------------------------------------------------------------------------
// RealtimeTracer
// ---------------------------------------------------------------------------

const SCOPE_NAME = "refract.realtime";
const SCOPE_VERSION = "0.1.0";

export class RealtimeTracer {
  private readonly tracer: OtelTracer;
  private readonly meter: OtelMeter;

  // Metrics
  private readonly connectAttempts: OtelCounter;
  private readonly connectErrors: OtelCounter;
  private readonly reconnects: OtelCounter;
  private readonly messages: OtelCounter;
  private readonly activeSubscribers: OtelUpDownCounter;
  private readonly fallbackActivations: OtelCounter;
  private readonly sessionDuration: OtelHistogram;

  // State for session timing
  private sessionStart: number | null = null;

  // Active connection span (open → close).
  private connectSpan: OtelSpan | null = null;

  constructor(
    tracer: OtelTracer = tryGetTracer(SCOPE_NAME, SCOPE_VERSION),
    meter: OtelMeter = tryGetMeter(SCOPE_NAME, SCOPE_VERSION)
  ) {
    this.tracer = tracer;
    this.meter = meter;

    this.connectAttempts = this.meter.createCounter("realtime.connect.attempts", {
      description: "Total WebSocket connection attempts (including reconnects).",
    });
    this.connectErrors = this.meter.createCounter("realtime.connect.errors", {
      description:
        "Total WebSocket connection errors (new WebSocket() threw or error event fired).",
    });
    this.reconnects = this.meter.createCounter("realtime.reconnects", {
      description: "Total reconnect attempts scheduled after an unexpected close.",
    });
    this.messages = this.meter.createCounter("realtime.messages", {
      description: "Total frames dispatched from the WebSocket, broken down by topic.",
    });
    this.activeSubscribers = this.meter.createUpDownCounter("realtime.subscribe.active", {
      description:
        "Net active subscriber count per topic (increments on subscribe, decrements on unsubscribe).",
    });
    this.fallbackActivations = this.meter.createCounter("realtime.fallback.activations", {
      description: "Times the REST fallback path was activated because realtime was unavailable.",
    });
    this.sessionDuration = this.meter.createHistogram("realtime.session.duration_ms", {
      description: "Duration of a realtime connection session in milliseconds (open → close).",
      unit: "ms",
    });
  }

  onConnectAttempt(wsUrl: string, attempt: number): void {
    this.connectAttempts.add(1, { attempt });
    if (!this.connectSpan) {
      this.connectSpan = this.tracer.startSpan("realtime connect", {
        attributes: { "net.peer.address": wsUrl, attempt },
      });
    }
    if (this.sessionStart === null) {
      this.sessionStart = Date.now();
    }
  }

  onConnectError(wsUrl: string, err: unknown): void {
    this.connectErrors.add(1, { "net.peer.address": wsUrl });
    if (this.connectSpan) {
      this.connectSpan.recordException(err);
      this.connectSpan.setStatus({ code: 2 /* ERROR */ });
      this.connectSpan.end();
      this.connectSpan = null;
    }
  }

  onOpen(wsUrl: string): void {
    if (this.connectSpan) {
      this.connectSpan.setAttribute("net.peer.address", wsUrl);
      this.connectSpan.setAttribute("connected", true);
    }
  }

  onClose(wsUrl: string): void {
    if (this.connectSpan) {
      this.connectSpan.setAttribute("net.peer.address", wsUrl);
      this.connectSpan.end();
      this.connectSpan = null;
    }
    if (this.sessionStart !== null) {
      this.sessionDuration.record(Date.now() - this.sessionStart);
    }
  }

  onError(wsUrl: string): void {
    this.connectErrors.add(1, { "net.peer.address": wsUrl });
  }

  onReconnectScheduled(delayMs: number, attempt: number): void {
    this.reconnects.add(1, { attempt, delay_ms: delayMs });
  }

  onMessage(topic: string): void {
    this.messages.add(1, { topic });
    const span = this.tracer.startSpan("realtime message", { attributes: { topic } });
    span.end();
  }

  onSubscribe(topic: string, subscriberCount: number): void {
    this.activeSubscribers.add(1, { topic });
    void subscriberCount; // available for richer attributes if desired later
  }

  onUnsubscribe(topic: string, remaining: number): void {
    this.activeSubscribers.add(-1, { topic });
    void remaining;
  }

  onDisconnect(): void {
    if (this.sessionStart !== null) {
      this.sessionDuration.record(Date.now() - this.sessionStart);
      this.sessionStart = null;
    }
    if (this.connectSpan) {
      this.connectSpan.end();
      this.connectSpan = null;
    }
  }

  onFallbackActivated(reason: string): void {
    this.fallbackActivations.add(1, { reason });
    const span = this.tracer.startSpan("realtime fallback", { attributes: { reason } });
    span.end();
  }

  /**
   * Inject a custom tracer/meter (used in tests to capture telemetry calls
   * without a real OTel SDK).
   */
  static withBackends(tracer: OtelTracer, meter: OtelMeter): RealtimeTracer {
    return new RealtimeTracer(tracer, meter);
  }
}

/** Module-level singleton — shares lifetime with the realtime client. */
export const realtimeTracer = new RealtimeTracer();
