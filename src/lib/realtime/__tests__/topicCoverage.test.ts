import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REALTIME_TOPICS } from "../contract";
import { MOCK_PRODUCERS } from "../testing/producers";

/**
 * Topics intentionally lacking a real consumer. Every entry needs a reason and
 * is itself validated: stale entries (unknown topic, or now consumed) fail.
 */
export const UNCONSUMED_ALLOWLIST: Record<string, string> = {
  oracle_update: "realtimeClient is wired behind the disabled `realtime-oracle` flag; no hook subscribes yet.",
};

const SRC = join(process.cwd(), "src");
const SKIP = /(__tests__|\/testing|\.test\.tsx?$|\/realtime\/contract\.ts$)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !SKIP.test(p)) out.push(p);
  }
  return out;
}

export function findConsumers(topic: string, files: Record<string, string>): string[] {
  const re = new RegExp(`subscribe\\(\\s*["'\`]${topic}["'\`]`);
  return Object.keys(files).filter((f) => re.test(files[f]));
}

const files = Object.fromEntries(walk(SRC).map((f) => [f, readFileSync(f, "utf8")]));
const topics = Object.keys(REALTIME_TOPICS);

describe("realtime topic coverage", () => {
  it.each(topics)("%s has a producer, a consumer (or allowlist entry) and valid fixtures", (topic) => {
    const def = REALTIME_TOPICS[topic as keyof typeof REALTIME_TOPICS];
    expect(MOCK_PRODUCERS[topic], `${topic}: no mock producer`).toBeDefined();
    expect(def.fixtures.length, `${topic}: no fixtures`).toBeGreaterThan(0);
    for (const fixture of def.fixtures) {
      expect(() => def.parse(fixture), `${topic}: fixture fails validation`).not.toThrow();
    }
    if (!(topic in UNCONSUMED_ALLOWLIST)) {
      expect(findConsumers(topic, files), `${topic}: no consumer`).not.toHaveLength(0);
    }
  });

  it("has no producers for unknown topics and a valid allowlist", () => {
    for (const t of Object.keys(MOCK_PRODUCERS)) expect(topics, `producer for unknown topic ${t}`).toContain(t);
    for (const [t, reason] of Object.entries(UNCONSUMED_ALLOWLIST)) {
      expect(topics, `stale allowlist entry ${t}`).toContain(t);
      expect(reason.length).toBeGreaterThan(0);
      expect(findConsumers(t, files), `${t} is now consumed; remove from allowlist`).toHaveLength(0);
    }
  });

  it("meta: detects a missing consumer and an invalid fixture", () => {
    expect(findConsumers("x", { a: 'realtimeClient.subscribe("x", h)' })).toEqual(["a"]);
    expect(findConsumers("x", { a: "nothing" })).toEqual([]);
    expect(() => REALTIME_TOPICS.oracle_update.parse({ severity: "bad" })).toThrow();
  });
});
