import { describe, expect, it } from "vitest";
import {
  ClockSkewEstimator,
  formatNormalizedRelativeAge,
  normalizeEventTimestamp,
} from "./clockSkew";

describe("ClockSkewEstimator & Event Timestamp Normalization", () => {
  it("estimates midpoint clock offset and filters out high-RTT asymmetric latency spikes", () => {
    const estimator = new ClockSkewEstimator({
      maxSamples: 6,
      skewWarningThresholdMs: 30_000,
    });

    // True server offset is +5,000ms (server is 5s ahead of client)
    estimator.recordSample({
      clientSendTs: 100_000,
      serverTs: 105_050,
      clientReceiveTs: 100_100, // RTT = 100ms, midpoint = 100_050 -> offset = +5,000ms
    });
    estimator.recordSample({
      clientSendTs: 110_000,
      serverTs: 115_060,
      clientReceiveTs: 110_120, // RTT = 120ms, midpoint = 110_060 -> offset = +5,000ms
    });
    // Inject a single asymmetric network spike outlier (RTT = 4,000ms, skewed offset = +6,900ms)
    estimator.recordSample({
      clientSendTs: 120_000,
      serverTs: 128_900,
      clientReceiveTs: 124_000,
    });

    const diag = estimator.getDiagnostics();
    expect(diag.offsetMs).toBe(5_000);
    expect(diag.uncertaintyMs).toBe(50);
    expect(diag.sampleCount).toBe(3);
    expect(diag.skewWarningActive).toBe(false);
  });

  it("normalizes relative event age accurately even when the client clock is skewed by hours", () => {
    const estimator = new ClockSkewEstimator({
      skewWarningThresholdMs: 30_000,
    });

    const threeHoursMs = 3 * 3600 * 1_000;
    // Client clock is 3 hours behind server clock (offsetMs = +10_800_000)
    estimator.recordSample({
      clientSendTs: 1_000_000,
      serverTs: 1_000_000 + threeHoursMs + 40,
      clientReceiveTs: 1_000_080,
    });

    expect(estimator.getDiagnostics().skewWarningActive).toBe(true);
    expect(estimator.getDiagnostics().offsetMs).toBe(threeHoursMs);

    // Event happened 12 seconds ago on the server
    const currentClientNow = 2_000_000;
    const currentServerNow = currentClientNow + threeHoursMs;
    const serverEventTs = currentServerNow - 12_000;

    expect(normalizeEventTimestamp(serverEventTs, estimator)).toBe(currentClientNow - 12_000);
    expect(estimator.getEventAgeMs(serverEventTs, currentClientNow)).toBe(12_000);
    expect(formatNormalizedRelativeAge(serverEventTs, currentClientNow, estimator)).toBe(
      "12s ago",
    );
  });

  it("invalidates stale samples and re-anchors when a mid-session clock jump occurs", () => {
    const estimator = new ClockSkewEstimator({
      clockJumpResetMs: 60_000,
    });

    estimator.recordSample({
      clientSendTs: 10_000,
      serverTs: 10_050,
      clientReceiveTs: 10_100, // offset = 0
    });
    estimator.recordSample({
      clientSendTs: 20_000,
      serverTs: 20_050,
      clientReceiveTs: 20_100, // offset = 0
    });
    expect(estimator.getDiagnostics().offsetMs).toBe(0);

    // User's OS clock jumps by 120,000ms (>= clockJumpResetMs = 60,000ms)
    estimator.recordSample({
      clientSendTs: 30_000,
      serverTs: 150_050,
      clientReceiveTs: 30_100, // offset = +120,000ms
    });

    const diag = estimator.getDiagnostics();
    expect(diag.sampleCount).toBe(1);
    expect(diag.offsetMs).toBe(120_000);
    expect(diag.skewWarningActive).toBe(true);
  });
});
