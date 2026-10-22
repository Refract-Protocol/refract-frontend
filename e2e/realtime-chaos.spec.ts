import { spawn, type ChildProcess } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * Browser-level chaos smoke: drives the real client in a real browser against
 * scripts/mock-realtime-server.ts and checks what the user sees on the
 * /dev/realtime panel after each fault.
 *
 * Run with `npm run test:chaos:e2e` (needs the /dev routes enabled via
 * NEXT_PUBLIC_ENABLE_UI_GALLERY=true, which that script sets).
 */

const MOCK_PORT = 4010;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const PANEL = `/dev/realtime?api=${encodeURIComponent(`${MOCK}/api/v1`)}`;

test.skip(
  process.env.NEXT_PUBLIC_ENABLE_UI_GALLERY !== "true",
  "requires NEXT_PUBLIC_ENABLE_UI_GALLERY=true (use npm run test:chaos:e2e)"
);
test.describe.configure({ mode: "serial" });

let mock: ChildProcess | null = null;

async function control(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${MOCK}/__control`, { method: "POST", body: JSON.stringify(body) });
  expect(res.ok).toBe(true);
}

async function startMock(): Promise<void> {
  mock = spawn(
    "npx",
    [
      "--yes",
      "tsx",
      "scripts/mock-realtime-server.ts",
      "--port",
      String(MOCK_PORT),
      "--ping",
      "2000",
    ],
    // Own process group, so stopping it also stops the node child npx spawns.
    { stdio: "inherit", detached: true }
  );
  await expect
    .poll(async () => (await fetch(`${MOCK}/__state`).catch(() => null))?.ok ?? false, {
      timeout: 30_000,
    })
    .toBe(true);
}

async function expectOpen(page: Page): Promise<void> {
  await expect(page.getByTestId("realtime-status")).toHaveText("open", { timeout: 15_000 });
}

test.beforeAll(async () => {
  await startMock();
});

test.afterAll(() => {
  if (mock?.pid) process.kill(-mock.pid, "SIGTERM");
  mock = null;
});

test.beforeEach(async () => {
  // Healthy backend, no lingering connections from the previous test.
  await control({ action: "scenario", scenario: {} });
  await control({ action: "drop", code: 1001 });
});

test("recovers from a backend restart and keeps showing live events", async ({ page }) => {
  await page.goto(PANEL);
  await expectOpen(page);
  await expect(page.getByTestId("realtime-transport")).toHaveText("websocket");

  await control({ action: "publish", payload: { value: 1 } });
  await expect(page.getByTestId("realtime-events")).toContainText('{"value":1}');

  await control({ action: "restart" });
  await control({ action: "publish", payload: { value: 2 } }); // while the client is away
  await expectOpen(page);
  await expect(page.getByTestId("realtime-count-reconnects")).not.toHaveText("0");
  await expect(page.getByTestId("realtime-events")).toContainText('{"value":2}');

  // Malformed frames are counted, not fatal.
  await control({ action: "raw", text: "{garbage" });
  await expect(page.getByTestId("realtime-count-decode-errors")).toHaveText("1");
  await expectOpen(page);
});

test("shows the paused banner when reconnects are rejected for auth", async ({ page }) => {
  await page.goto(PANEL);
  await expectOpen(page);
  await control({ action: "scenario", scenario: { default: { rejectAuth: true } } });
  await control({ action: "drop", code: 1006 });
  await expect(page.getByTestId("realtime-degraded")).toContainText(
    "Live updates are paused (sign-in expired)"
  );
  await expect(page.getByTestId("realtime-degraded-reason")).toHaveText("auth");
});

test("falls back to long-poll when WebSocket connections are refused", async ({ page }) => {
  await control({ action: "scenario", scenario: { default: { refuse: { code: 1006 } } } });
  await page.goto(PANEL);
  await expect(page.getByTestId("realtime-transport")).toHaveText("long-poll", { timeout: 20_000 });
  await expect(page.getByTestId("realtime-negotiation")).toContainText("websocket: failed");

  await control({ action: "publish", payload: { value: 3 } });
  await expect(page.getByTestId("realtime-events")).toContainText('{"value":3}');
});

test("decodes large frames in the bundled Web Worker", async ({ page }) => {
  await page.goto(PANEL);
  await expectOpen(page);
  // ~35 KB: above the 16 KB threshold, so it must be offloaded.
  const rows = Array.from({ length: 1_000 }, (_, i) => ({ feed: `USDC/USD#${i}`, value: 0.999 }));
  await control({ action: "publish", payload: { rows } });
  await expect(page.getByTestId("realtime-count-decoded-worker")).toHaveText("1");
  await expect(page.getByTestId("realtime-decode-mode")).toHaveText("worker");
  await expect(page.getByTestId("realtime-events")).toContainText("USDC/USD#999");
});
