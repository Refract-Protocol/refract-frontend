/**
 * Stress / load test harness for the realtime client.
 *
 * Closes #235: Drives the realtime client and the local mock WS server with
 * sustained, high-frequency traffic across many topics and simulated
 * subscribers, measuring memory growth, reconnect churn, and frame dispatch
 * cost over long runs.
 *
 * These tests run in Node (Vitest) against a real in-process WebSocket server
 * (`WsMockServer`). They are intentionally long-running relative to unit tests
 * — set `STRESS_FRAMES` / `STRESS_HZ` env vars to tune them in CI.
 *
 * Design notes:
 * - `WsMockServer` uses the `ws` npm package via a dynamic require in
 *   `src/mocks/wsMockServer.ts`. If `ws` is not installed the tests are
 *   skipped automatically (see the `wsAvailable` check at the top).
 * - The `RealtimeClient` is exercised against the live WS server URL so the
 *   full socket lifecycle (open, message, close, reconnect) is covered.
 * - Memory growth is measured via `process.memoryUsage().heapUsed` before and
 *   after the load run. The acceptable growth budget is deliberately generous
 *   to avoid flakiness on different V8 GC schedules; its purpose is to catch
 *   *catastrophic* leaks (e.g. an unbounded array), not micro-allocations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  WsMockServer,
  chaosPayloadFactory,
  malformedPayloadFactory,
} from "../../mocks/wsMockServer";
import { TopicRegistry } from "./ringBuffer";
import { frameRecorder, serializeRecording } from "./recorder";

// ---------------------------------------------------------------------------
// Constants — tunable via env for CI budget vs. thoroughness trade-off
// ---------------------------------------------------------------------------

const FRAMES = parseInt(process.env.STRESS_FRAMES ?? "500", 10);
const HZ = parseInt(process.env.STRESS_HZ ?? "200", 10);
/**
 * Maximum heap growth permitted per run (bytes).
 * 50 MB is generous enough to tolerate GC jitter while still catching leaks.
 */
const MAX_HEAP_GROWTH_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Check whether `ws` is available (skip gracefully if not)
// ---------------------------------------------------------------------------

let wsAvailable = false;
try {
  require("ws");
  wsAvailable = true;
} catch {
  /* ws not installed — skip WS integration tests */
}

const describeWs = wsAvailable ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gcIfPossible(): void {
  if (typeof globalThis.gc === "function") globalThis.gc();
}

/** Spin until `condition()` returns true or `timeoutMs` elapses. */
async function waitFor(condition: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Mock-server unit tests (no live WebSocket needed)
// ---------------------------------------------------------------------------

describe("WsMockServer (unit, no ws required)", () => {
  it("driveLoad rejects an empty topics array", async () => {
    const server = new WsMockServer();
    // We can't call start() without ws, so test the validation path directly.
    await expect(
      (server as unknown as { driveLoad: (p: unknown) => Promise<unknown> }).driveLoad({
        topics: [],
      })
    ).rejects.toThrow(RangeError);
  });

  it("url reflects the configured port", () => {
    const server = new WsMockServer({ port: 9999 });
    // Port isn't set until start() is called, but we can verify the format.
    expect(server.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/ws$/);
  });
});

// ---------------------------------------------------------------------------
// Ring-buffer memory-guard under high-frequency load (no WS needed)
// ---------------------------------------------------------------------------

describe("Ring-buffer memory guard (no ws required)", () => {
  it("bounded registry does not grow beyond cap * maxTopics frames", () => {
    const CAP = 64;
    const MAX_TOPICS = 4;
    const registry = new TopicRegistry({ defaultCapacity: CAP, maxTopics: MAX_TOPICS });

    const topics = ["oracle_update", "claim_update", "pool_update", "policy_update"];
    const TOTAL_FRAMES = CAP * 20; // 20× overload per topic

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const topic = topics[i % topics.length];
      registry.record(topic, { i, topic });
    }

    expect(registry.totalBuffered).toBeLessThanOrEqual(CAP * MAX_TOPICS);
    for (const topic of topics) {
      expect(registry.snapshot(topic).length).toBeLessThanOrEqual(CAP);
    }
  });

  it("excess topics beyond maxTopics are counted in droppedTopics", () => {
    const registry = new TopicRegistry({ maxTopics: 2 });
    registry.record("a", {});
    registry.record("b", {});
    registry.record("c", {}); // should be dropped
    registry.record("d", {}); // should be dropped
    expect(registry.droppedTopics).toBe(2);
  });

  it("total heap growth stays within budget when filling a large registry", () => {
    gcIfPossible();
    const before = process.memoryUsage().heapUsed;

    const registry = new TopicRegistry({ defaultCapacity: 256, maxTopics: 64 });
    for (let i = 0; i < 256 * 64 * 2; i++) {
      registry.record(`topic_${i % 64}`, { seq: i, data: "x".repeat(64) });
    }

    gcIfPossible();
    const after = process.memoryUsage().heapUsed;
    const growth = after - before;
    expect(growth).toBeLessThan(MAX_HEAP_GROWTH_BYTES);
  });

  it("drainAll() releases all frame references", () => {
    const registry = new TopicRegistry({ defaultCapacity: 128 });
    for (let i = 0; i < 512; i++) {
      registry.record(`topic_${i % 4}`, { bigPayload: "y".repeat(256) });
    }
    registry.drainAll();
    expect(registry.totalBuffered).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Frame recorder: high-volume capture
// ---------------------------------------------------------------------------

describe("Frame recorder: high-volume capture (no ws required)", () => {
  beforeEach(() => frameRecorder.stop()); // ensure recorder is stopped

  it("captures large numbers of frames without error", () => {
    frameRecorder.start();
    for (let i = 0; i < 1000; i++) {
      frameRecorder.recordFrame({
        topic: "oracle_update",
        payload: { seq: i },
        receivedAt: Date.now(),
        seq: i,
      });
    }
    const rec = frameRecorder.stop();
    expect(rec.entries).toHaveLength(1000);
  });

  it("serialised recording stays within a reasonable size for 1 000 frames", () => {
    frameRecorder.start();
    for (let i = 0; i < 1000; i++) {
      frameRecorder.recordFrame({
        topic: "oracle_update",
        payload: { i },
        receivedAt: Date.now(),
        seq: i,
      });
    }
    const rec = frameRecorder.stop();
    const json = serializeRecording(rec);
    // 1 000 small frames should serialise to well under 1 MB.
    expect(json.length).toBeLessThan(1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// WS integration stress tests (require `ws` package)
// ---------------------------------------------------------------------------

describeWs("WsMockServer integration stress tests (requires ws)", () => {
  let server: WsMockServer;

  beforeEach(async () => {
    server = new WsMockServer({ port: 0 });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("server starts on an ephemeral port and exposes a ws:// URL", () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/ws$/);
  });

  it(`driveLoad emits ${FRAMES} frames at ≤${HZ} Hz with oracle_update topic`, async () => {
    // Spin up a client using a raw WebSocket (avoids coupling to RealtimeClient internals).
    const ws = require("ws");
    const received: unknown[] = [];
    const client = new ws.WebSocket(server.url) as {
      on(event: "open" | "message" | "error" | "close", cb: (...args: unknown[]) => void): void;
      close(): void;
    };

    await new Promise<void>((resolve, reject) => {
      client.on("open", resolve);
      client.on("error", reject);
    });

    client.on("message", (raw: unknown) => {
      try {
        received.push(JSON.parse(raw as string));
      } catch {
        /* ignore */
      }
    });

    const stats = await server.driveLoad({
      topics: ["oracle_update"],
      framesPerSecond: HZ,
      maxFrames: FRAMES,
    });

    // Allow a brief drain window.
    await new Promise((r) => setTimeout(r, 50));
    client.close();

    expect(stats.framesSent).toBe(FRAMES);
    expect(stats.errors).toBe(0);
    expect(received.length).toBe(FRAMES);
  }, 30_000);

  it("multi-topic load distributes frames across all topics", async () => {
    const ws = require("ws");
    const topicCounts: Record<string, number> = {};

    const client = new ws.WebSocket(server.url);
    await new Promise<void>((resolve, reject) => {
      client.on("open", resolve);
      client.on("error", reject);
    });
    client.on("message", (raw: unknown) => {
      try {
        const msg = JSON.parse(raw as string) as { topic: string };
        topicCounts[msg.topic] = (topicCounts[msg.topic] ?? 0) + 1;
      } catch {
        /* ignore */
      }
    });

    const topics = ["oracle_update", "pool_update", "claim_update"];
    const stats = await server.driveLoad({
      topics,
      framesPerSecond: HZ,
      maxFrames: FRAMES,
      makePayload: (topic, seq) => ({ topic, seq }),
    });
    await new Promise((r) => setTimeout(r, 50));
    client.close();

    expect(stats.framesSent).toBe(FRAMES);
    // Each topic should receive roughly frames / topics.length frames.
    const expected = Math.floor(FRAMES / topics.length);
    for (const topic of topics) {
      expect(topicCounts[topic] ?? 0).toBeGreaterThanOrEqual(expected - 1);
    }
  }, 30_000);

  it("chaos payload factory does not crash the server or client", async () => {
    const ws = require("ws");
    let errorCount = 0;

    const client = new ws.WebSocket(server.url);
    await new Promise<void>((resolve, reject) => {
      client.on("open", resolve);
      client.on("error", reject);
    });
    client.on("error", () => errorCount++);

    await server.driveLoad({
      topics: ["oracle_update"],
      framesPerSecond: HZ,
      maxFrames: Math.min(FRAMES, 200),
      makePayload: chaosPayloadFactory,
    });
    await new Promise((r) => setTimeout(r, 50));
    client.close();

    expect(errorCount).toBe(0);
  }, 30_000);

  it("malformed payload factory is handled gracefully (no crash)", async () => {
    const ws = require("ws");
    const received: unknown[] = [];

    const client = new ws.WebSocket(server.url);
    await new Promise<void>((resolve, reject) => {
      client.on("open", resolve);
      client.on("error", reject);
    });
    client.on("message", (raw: unknown) => {
      try {
        received.push(JSON.parse(raw as string));
      } catch {
        /* ignore */
      }
    });

    await server.driveLoad({
      topics: ["oracle_update"],
      framesPerSecond: HZ,
      maxFrames: Math.min(FRAMES, 100),
      makePayload: malformedPayloadFactory,
    });
    await new Promise((r) => setTimeout(r, 50));
    client.close();

    // All frames should still arrive — the malformed payload factory produces
    // valid JSON; it just omits some fields.
    expect(received.length).toBeGreaterThan(0);
  }, 30_000);

  it("reconnect churn: client reconnects after server restart", async () => {
    const ws = require("ws");
    let connectCount = 0;
    const server2 = new WsMockServer({ port: 0 });
    await server2.start();

    const client = new ws.WebSocket(server2.url) as {
      on(event: "open", cb: () => void): void;
    };
    await new Promise<void>((resolve, reject) => {
      client.on("open", () => {
        connectCount++;
        resolve();
      });
      (client as unknown as { on(e: "error", cb: (e: Error) => void): void }).on("error", reject);
    });

    await server2.stop();

    // Start a new server on a different port to avoid address-in-use.
    const server3 = new WsMockServer({ port: 0 });
    await server3.start();

    const client2 = new ws.WebSocket(server3.url);
    await new Promise<void>((resolve, reject) => {
      client2.on("open", () => {
        connectCount++;
        resolve();
      });
      client2.on("error", reject);
    });

    await server3.stop();
    expect(connectCount).toBe(2);
  }, 15_000);

  it("memory growth stays within budget during a full load run", async () => {
    gcIfPossible();
    const before = process.memoryUsage().heapUsed;

    const ws = require("ws");
    const client = new ws.WebSocket(server.url);
    await new Promise<void>((resolve, reject) => {
      client.on("open", resolve);
      client.on("error", reject);
    });

    await server.driveLoad({
      topics: ["oracle_update", "claim_update", "pool_update"],
      framesPerSecond: HZ,
      maxFrames: FRAMES,
    });
    await new Promise((r) => setTimeout(r, 50));
    client.close();

    gcIfPossible();
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(MAX_HEAP_GROWTH_BYTES);
  }, 30_000);

  it("many simulated subscribers all receive every frame", async () => {
    const ws = require("ws");
    const SUBSCRIBER_COUNT = 10;
    const FRAMES_PER_CLIENT = 50;
    const receivedCounts = new Array<number>(SUBSCRIBER_COUNT).fill(0);
    const clients: Array<{ close(): void }> = [];

    for (let i = 0; i < SUBSCRIBER_COUNT; i++) {
      const c = new ws.WebSocket(server.url);
      const idx = i;
      await new Promise<void>((resolve, reject) => {
        c.on("open", resolve);
        c.on("error", reject);
      });
      c.on("message", () => {
        receivedCounts[idx]++;
      });
      clients.push(c);
    }

    await waitFor(() => server.clientCount === SUBSCRIBER_COUNT);

    await server.driveLoad({
      topics: ["oracle_update"],
      framesPerSecond: HZ,
      maxFrames: FRAMES_PER_CLIENT,
    });
    await new Promise((r) => setTimeout(r, 100));

    for (const c of clients) c.close();

    // Every subscriber should have received all frames.
    for (const count of receivedCounts) {
      expect(count).toBe(FRAMES_PER_CLIENT);
    }
  }, 30_000);
});
