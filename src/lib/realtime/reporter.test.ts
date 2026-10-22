import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./client";
import { RealtimeConnectionError, RealtimeValidationError } from "./errors";
import {
  createReporter,
  createSentrySink,
  scrub,
  scrubString,
  type RealtimeBreadcrumb,
  type RealtimeErrorContext,
  type RealtimeReporter,
  type SentryLike,
} from "./reporter";
import { fakeSocketFactory } from "./testing/fakeSocket";

const ACCOUNT = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.c2lnbmF0dXJl";

const ctx: RealtimeErrorContext = {
  topic: "oracle_update",
  transport: "websocket",
  attempt: 0,
  fallback: "none",
};

function recordingSink() {
  const errors: { error: Error; context: Record<string, unknown> }[] = [];
  const crumbs: RealtimeBreadcrumb[] = [];
  const sink: RealtimeReporter = {
    captureError: (error, context) =>
      errors.push({ error, context: context as unknown as Record<string, unknown> }),
    addBreadcrumb: (crumb) => crumbs.push(crumb),
  };
  return { sink, errors, crumbs };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("scrubbing", () => {
  it("redacts bearer tokens, secret query params and wallet addresses in strings", () => {
    const out = scrubString(`Bearer ${TOKEN} wss://api/ws?token=${TOKEN}&x=1 for ${ACCOUNT}`);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(ACCOUNT);
    expect(out).toContain("[account]");
  });

  it("redacts sensitive keys and wallet-scoped fields in nested data", () => {
    const out = scrub({
      authToken: TOKEN,
      nested: { signature: "abc", account: ACCOUNT, note: `owner ${ACCOUNT}` },
      list: [{ holder: ACCOUNT }],
      attempt: 3,
    });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(JSON.stringify(out)).not.toContain(ACCOUNT);
    expect(out).toMatchObject({
      authToken: "[redacted]",
      attempt: 3,
      nested: { signature: "[redacted]" },
    });
  });

  it("never forwards tokens or addresses from an error to the sink", () => {
    const { sink, errors } = recordingSink();
    const reporter = createReporter(sink);
    const error = new RealtimeValidationError(`bad frame for ${ACCOUNT} token=${TOKEN}`, {
      topic: "holder_claim",
      cause: { raw: TOKEN },
    });
    reporter.captureError(error, { ...ctx, topic: "holder_claim" });

    const sent = errors[0]!;
    const serialised = JSON.stringify({
      message: sent.error.message,
      stack: sent.error.stack,
      cause: sent.error.cause,
      ...sent.context,
    });
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain(ACCOUNT);
    expect(sent.error).toBeInstanceOf(RealtimeValidationError);
    // The original error is untouched.
    expect(error.message).toContain(ACCOUNT);
  });
});

describe("rate limiting", () => {
  it("deduplicates errors by topic + kind within the window and reports the suppressed count", () => {
    const { sink, errors } = recordingSink();
    const reporter = createReporter(sink, { errorDedupWindowMs: 60_000 });
    for (let i = 0; i < 10; i += 1)
      reporter.captureError(new RealtimeValidationError("x", { topic: "oracle_update" }), ctx);
    reporter.captureError(new RealtimeValidationError("x", { topic: "claim_settled" }), {
      ...ctx,
      topic: "claim_settled",
    });
    expect(errors).toHaveLength(2);

    vi.advanceTimersByTime(60_000);
    reporter.captureError(new RealtimeValidationError("x", { topic: "oracle_update" }), ctx);
    expect(errors).toHaveLength(3);
    expect(errors[2]!.context).toMatchObject({ suppressed: 9 });
  });

  it("caps breadcrumbs per window and collapses identical consecutive ones", () => {
    const { sink, crumbs } = recordingSink();
    const reporter = createReporter(sink, { breadcrumbLimit: 5, breadcrumbWindowMs: 60_000 });
    for (let i = 0; i < 50; i += 1)
      reporter.addBreadcrumb({ event: "closed", level: "warning", data: { code: 1006 } });
    expect(crumbs).toHaveLength(1);

    for (let attempt = 1; attempt <= 50; attempt += 1) {
      reporter.addBreadcrumb({ event: "reconnect_scheduled", level: "warning", data: { attempt } });
    }
    expect(crumbs).toHaveLength(5);

    vi.advanceTimersByTime(60_000);
    reporter.addBreadcrumb({ event: "open", level: "info" });
    expect(crumbs).toHaveLength(6);
    expect(crumbs[5]!.data).toMatchObject({ droppedBefore: 46 });
  });

  it("a reconnect storm through the real client yields one error event and bounded breadcrumbs", () => {
    const { sink, errors, crumbs } = recordingSink();
    const sockets = fakeSocketFactory();
    const client = new RealtimeClient({
      createSocket: sockets.create,
      reporter: createReporter(sink, { breadcrumbLimit: 20 }),
      maxAttempts: 3,
      maxBackoffMs: 1_000,
    });
    client.setEnabled(true);
    client.subscribe("oracle_update", () => {});
    for (let i = 0; i < 40; i += 1) {
      sockets.latest().serverDrop();
      vi.advanceTimersByTime(1_000);
    }
    expect(
      errors.filter((e) => (e.error as RealtimeConnectionError).kind === "retries_exhausted")
    ).toHaveLength(1);
    expect(crumbs.length).toBeLessThanOrEqual(20);
  });
});

describe("Sentry sink", () => {
  it("captures with structured tags and a stable fingerprint", () => {
    const sentry: SentryLike = { captureException: vi.fn(), addBreadcrumb: vi.fn() };
    const sink = createSentrySink(() => sentry);
    const error = new RealtimeConnectionError("gave up", "retries_exhausted");
    sink.captureError(error, {
      topic: undefined,
      transport: "websocket",
      attempt: 6,
      fallback: "all",
    });

    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: {
        "realtime.kind": "retries_exhausted",
        "realtime.topic": "none",
        "realtime.transport": "websocket",
        "realtime.attempt": "6",
        "realtime.fallback": "all",
        "realtime.retryable": "false",
      },
      fingerprint: ["realtime", "retries_exhausted", "none"],
      extra: {},
    });
  });

  it("forwards breadcrumbs under the realtime category", () => {
    const sentry: SentryLike = { captureException: vi.fn(), addBreadcrumb: vi.fn() };
    createSentrySink(() => sentry).addBreadcrumb({
      event: "open",
      level: "info",
      data: { epoch: 1 },
    });
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: "realtime",
      message: "open",
      level: "info",
      data: { epoch: 1 },
    });
  });

  it("is a no-op when the Sentry SDK isn't loaded", () => {
    const sink = createSentrySink(() => undefined);
    expect(() => sink.captureError(new RealtimeValidationError("x"), ctx)).not.toThrow();
    expect(() => sink.addBreadcrumb({ event: "open", level: "info" })).not.toThrow();
  });
});
