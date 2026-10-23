import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * Network-condition coverage for the realtime layer (/provide live activity).
 *
 * Degradation is driven through a controllable mock realtime server
 * (`page.routeWebSocket`) and Playwright context controls rather than real
 * network shaping, so every timeline is deterministic. Chromium-only: CI
 * installs just Chromium. Each test is bounded by the 60s config timeout and
 * the whole file runs in well under a minute.
 */
test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only network emulation");

interface MockServer {
  /** Subscribe batches received, in order. */
  subscribes: string[][];
  /** Number of socket connection attempts (including refused ones). */
  attempts: number;
  setOnline(online: boolean): void;
  send(topic: string, payload: unknown): void;
  /** Drops the current socket as a lossy link would. */
  drop(): void;
  /** Delay applied to every outbound message (ms). */
  latencyMs: number;
  /** Events replayed as the snapshot on each subscribe. */
  snapshot: unknown[];
}

async function mockRealtime(page: Page): Promise<MockServer> {
  let current: WebSocketRoute | null = null;
  let online = true;
  const server: MockServer = {
    subscribes: [],
    attempts: 0,
    latencyMs: 0,
    snapshot: [],
    setOnline: (v) => {
      online = v;
      if (!v) current?.close();
    },
    send: (topic, payload) => {
      const msg = JSON.stringify({ topic, payload });
      const ws = current;
      if (!ws) return;
      if (server.latencyMs > 0) setTimeout(() => ws.send(msg), server.latencyMs);
      else ws.send(msg);
    },
    drop: () => current?.close(),
  };

  await page.routeWebSocket(/\/ws$/, (ws) => {
    server.attempts += 1;
    if (!online) {
      ws.close();
      return;
    }
    current = ws;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as { type: string; topics: string[] };
      if (msg.type !== "subscribe") return;
      server.subscribes.push(msg.topics);
      for (const e of server.snapshot) server.send("pool_activity", e);
      server.send("pool_presence", { active: 3 });
    });
  });
  return server;
}

const deposit = (id: string) => ({ id, kind: "deposit", at: Date.now(), sizeBucket: "$1k–10k" });
const feedItems = (page: Page) => page.getByTestId("pool-activity-feed").locator("li");

test.describe("realtime degradation and recovery", () => {
  test("offline fixture actually disables the transport (non-vacuous)", async ({ page }) => {
    const server = await mockRealtime(page);
    server.setOnline(false);
    await page.goto("/provide");
    await expect(page.getByTestId("realtime-degraded")).toBeVisible();
    expect(server.subscribes).toHaveLength(0);
    expect(server.attempts).toBeGreaterThan(0);
    await expect(page.getByTestId("pool-presence")).toHaveText("Presence unavailable");
  });

  test("hard offline: stale indicator + REST content, then recovery without duplicates", async ({
    page,
  }) => {
    const server = await mockRealtime(page);
    server.snapshot = [deposit("a"), deposit("b")];
    await page.goto("/provide");
    await expect(feedItems(page)).toHaveCount(2);
    await expect(page.getByTestId("pool-presence")).toContainText("3 providers active now");
    await expect(page.getByTestId("realtime-degraded")).toHaveCount(0);

    server.setOnline(false);
    await expect(page.getByTestId("realtime-degraded")).toContainText("Offline");
    // REST-backed content is still served while realtime is down.
    await expect(page.getByText("Pool TVL")).toBeVisible();

    const before = server.subscribes.length;
    server.snapshot = [deposit("a"), deposit("b"), deposit("c")]; // snapshot replays old ids
    server.setOnline(true);
    await expect(page.getByTestId("realtime-degraded")).toHaveCount(0, { timeout: 15_000 });
    await expect(feedItems(page)).toHaveCount(3); // a, b deduped; c added
    expect(server.subscribes.length).toBeGreaterThan(before);
    expect(server.subscribes.at(-1)).toEqual(
      expect.arrayContaining(["pool_activity", "pool_presence"])
    );
  });

  test("intermittent socket drops resubscribe each time and never duplicate events", async ({
    page,
  }) => {
    const server = await mockRealtime(page);
    server.snapshot = [deposit("a")];
    await page.goto("/provide");
    await expect(feedItems(page)).toHaveCount(1);
    for (let i = 1; i <= 2; i++) {
      server.drop();
      await expect.poll(() => server.subscribes.length, { timeout: 15_000 }).toBe(i + 1);
    }
    await expect(page.getByTestId("realtime-degraded")).toHaveCount(0);
    await expect(feedItems(page)).toHaveCount(1);
  });

  test("high latency: events still arrive once, with no permanent stale banner", async ({
    page,
  }) => {
    const server = await mockRealtime(page);
    server.latencyMs = 1_500;
    server.snapshot = [deposit("slow")];
    await page.goto("/provide");
    await expect(feedItems(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("pool-presence")).toContainText("providers active now", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("realtime-degraded")).toHaveCount(0);
  });

  test("context offline + online keeps the page usable", async ({ page, context }) => {
    const server = await mockRealtime(page);
    await page.goto("/provide");
    await expect(page.getByTestId("pool-presence")).toContainText("providers active now");
    await context.setOffline(true);
    server.drop();
    await expect(page.getByTestId("realtime-degraded")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByTestId("realtime-degraded")).toHaveCount(0, { timeout: 15_000 });
  });
});
