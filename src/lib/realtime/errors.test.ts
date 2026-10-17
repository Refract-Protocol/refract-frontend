import { describe, expect, it } from "vitest";
import {
  classifyRealtimeFailure,
  REALTIME_ERROR_TAXONOMY,
  type RealtimeErrorKind,
} from "./errors";

describe("Realtime Error Taxonomy & User-Facing Failure States", () => {
  it("defines complete presentation metadata for every error kind without raw technical jargon", () => {
    const allKinds: RealtimeErrorKind[] = [
      "transport",
      "timeout",
      "rate_limit",
      "server_error",
      "auth",
      "contract_mismatch",
    ];

    for (const kind of allKinds) {
      const entry = REALTIME_ERROR_TAXONOMY[kind];
      expect(entry.kind).toBe(kind);
      expect(entry.userTitle.length).toBeGreaterThan(5);
      expect(entry.userMessage.length).toBeGreaterThan(10);
      expect(entry.recoveryHint.length).toBeGreaterThan(10);
      expect(entry.userMessage).not.toMatch(/WebSocket|ECONNREFUSED|SyntaxError|ZodError/i);
    }
  });

  it("classifies auth and contract mismatches as non-retryable and disables auto-reconnect", () => {
    const authErr = classifyRealtimeFailure({
      code: "TOKEN_EXPIRED",
      topic: "notifications",
      now: 5_000,
    });
    expect(authErr.kind).toBe("auth");
    expect(authErr.retryable).toBe(false);
    expect(authErr.shouldAutoReconnect).toBe(false);
    expect(authErr.recoveryAction).toBe("manual_retry");
    expect(authErr.topic).toBe("notifications");

    const contractErr = classifyRealtimeFailure({
      code: "VERSION_MISMATCH",
      reason: "Unsupported protocol version v=2 for raw socket",
      now: 6_000,
    });
    expect(contractErr.kind).toBe("contract_mismatch");
    expect(contractErr.retryable).toBe(false);
    expect(contractErr.shouldAutoReconnect).toBe(false);
    expect(contractErr.recoveryAction).toBe("fallback_to_rest");
    expect(contractErr.severity).toBe("critical");
  });

  it("classifies rate limits, server errors, heartbeat timeouts, and transport drops as retryable", () => {
    const rateLimited = classifyRealtimeFailure({
      code: "RATE_LIMITED",
      retryAfterMs: 5_000,
    });
    expect(rateLimited.kind).toBe("rate_limit");
    expect(rateLimited.retryable).toBe(true);
    expect(rateLimited.shouldAutoReconnect).toBe(true);
    expect(rateLimited.recoveryAction).toBe("inline_banner");
    expect(rateLimited.retryAfterMs).toBe(5_000);

    const serverErr = classifyRealtimeFailure({
      code: 1011,
      reason: "Upstream database connection pool exhausted",
    });
    expect(serverErr.kind).toBe("server_error");
    expect(serverErr.retryable).toBe(true);
    expect(serverErr.recoveryAction).toBe("fallback_to_rest");

    const timeoutErr = classifyRealtimeFailure({
      code: "HEARTBEAT_TIMEOUT",
      reason: "2 missed pongs",
    });
    expect(timeoutErr.kind).toBe("timeout");
    expect(timeoutErr.retryable).toBe(true);
    expect(timeoutErr.recoveryAction).toBe("silent_retry");

    const transportDrop = classifyRealtimeFailure({
      code: 1006,
      reason: "Abnormal closure: ECONNRESET at 127.0.0.1:4000",
    });
    expect(transportDrop.kind).toBe("transport");
    expect(transportDrop.retryable).toBe(true);
    expect(transportDrop.recoveryAction).toBe("silent_retry");
    expect(transportDrop.userMessage).not.toContain("ECONNRESET");
  });
});
