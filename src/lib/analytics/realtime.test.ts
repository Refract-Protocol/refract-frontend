import { afterEach, describe, expect, it, vi } from "vitest";
import { emitRealtimeEvent, setRealtimeAnalyticsSink } from "./realtime";

describe("realtime analytics privacy and sampling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setRealtimeAnalyticsSink(() => undefined);
  });

  it("batches coarse lifecycle fields and never includes wallet or payload data", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { doNotTrack: "0" });
    const sink = vi.fn();
    setRealtimeAnalyticsSink(sink);
    emitRealtimeEvent("topic_subscribed", { topic: "oracle_update" });
    emitRealtimeEvent("topic_subscribed", { topic: "GABC123" });
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(2);
    const payload = JSON.stringify(sink.mock.calls[0]![0]);
    expect(payload).toContain('"topic":"oracle_update"');
    expect(payload).not.toMatch(/G[A-Z2-7]{55}|token|walletAddress|payload/i);
    expect(JSON.stringify(sink.mock.calls[1]![0])).toContain('"topic":"other"');
  });

  it("suppresses repeated identical lifecycle events inside the session window", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { doNotTrack: "0" });
    const sink = vi.fn();
    setRealtimeAnalyticsSink(sink);
    const topic = `fuzz_${Date.now()}`;
    emitRealtimeEvent("topic_subscribed", { topic });
    emitRealtimeEvent("topic_subscribed", { topic });
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
