import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getEnvelopeDedupKey,
  MAX_REALTIME_FRAME_BYTES,
  REALTIME_PROTOCOL_JSON_SCHEMA,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_TOPICS,
  realtimeFrameSchema,
  realtimeTopicEnvelopeSchema,
  TOPIC_METADATA,
} from "./contract";

describe("Realtime Protocol Contract (v1)", () => {
  it("defines metadata and transport decisions for all canonical topics", () => {
    expect(REALTIME_TOPICS).toEqual([
      "oracle.readings",
      "claims.settlement",
      "pool.stats",
      "notifications",
    ]);

    for (const topic of REALTIME_TOPICS) {
      const meta = TOPIC_METADATA[topic];
      expect(meta.topic).toBe(topic);
      expect(meta.flagName).toMatch(/^realtime-/);
      expect(meta.primaryTransport).toBe("websocket");
      expect(meta.fallbackTransport).toBe("sse");
      expect(meta.dedupKeyFields.length).toBeGreaterThan(0);
    }
  });

  it("validates every JSON example payload in docs/realtime-protocol.md against its schema", () => {
    const docPath = path.resolve(process.cwd(), "docs/realtime-protocol.md");
    const markdown = fs.readFileSync(docPath, "utf8");
    const jsonBlocks = Array.from(markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)).map(
      (match) => match[1].trim(),
    );

    expect(jsonBlocks.length).toBeGreaterThanOrEqual(9);

    const seenTopics = new Set<string>();
    const seenControlTypes = new Set<string>();

    for (const block of jsonBlocks) {
      expect(Buffer.byteLength(block, "utf8")).toBeLessThanOrEqual(MAX_REALTIME_FRAME_BYTES);
      const parsedJson = JSON.parse(block) as Record<string, unknown>;
      const result = realtimeFrameSchema.safeParse(parsedJson);
      expect(result.success).toBe(true);

      if (result.success && "topic" in result.data && "payload" in result.data) {
        seenTopics.add(result.data.topic);
        const dedupKey = getEnvelopeDedupKey(result.data);
        expect(dedupKey).toContain(result.data.topic);
      } else if (result.success) {
        seenControlTypes.add(result.data.type);
      }
    }

    expect(Array.from(seenTopics).sort()).toEqual([...REALTIME_TOPICS].sort());
    expect(seenControlTypes.has("subscribe")).toBe(true);
    expect(seenControlTypes.has("unsubscribe")).toBe(true);
    expect(seenControlTypes.has("resume_ack")).toBe(true);
    expect(seenControlTypes.has("ping")).toBe(true);
    expect(seenControlTypes.has("pong")).toBe(true);
    expect(seenControlTypes.has("error")).toBe(true);
  });

  it("preserves unknown fields for forward-compatible schema evolution", () => {
    const frameWithExtra = {
      v: REALTIME_PROTOCOL_VERSION,
      id: "evt_extra_1",
      topic: "oracle.readings",
      type: "delta",
      seq: 10,
      ts: 1730000000000,
      futureEnvelopeField: "allowed",
      payload: {
        coverageType: "Flight Delay",
        type: "oracle_update",
        value: 45,
        threshold: 120,
        severity: "low",
        message: "On schedule",
        confidenceIntervalBps: 9950,
      },
    };

    const parsed = realtimeTopicEnvelopeSchema.parse(frameWithExtra);
    expect((parsed as Record<string, unknown>).futureEnvelopeField).toBe("allowed");
    expect((parsed.payload as Record<string, unknown>).confidenceIntervalBps).toBe(9950);
  });

  it("rejects mismatched protocol versions, unknown topics, and malformed payloads", () => {
    expect(
      realtimeFrameSchema.safeParse({
        v: 2,
        id: "evt_bad_v",
        topic: "oracle.readings",
        type: "delta",
        seq: 1,
        ts: 1730000000000,
        payload: {},
      }).success,
    ).toBe(false);

    expect(
      realtimeFrameSchema.safeParse({
        v: 1,
        id: "evt_bad_topic",
        topic: "unknown.topic",
        type: "delta",
        seq: 1,
        ts: 1730000000000,
        payload: {},
      }).success,
    ).toBe(false);

    expect(REALTIME_PROTOCOL_JSON_SCHEMA.properties.v.const).toBe(1);
  });
});
