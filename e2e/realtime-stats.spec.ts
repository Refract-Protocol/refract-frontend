import { expect, test } from "@playwright/test";

test("landing protocol statistics update after a protocol.stats push", async ({ page }) => {
  const sockets: Array<{ send: (message: string) => void }> = [];
  await page.route("**/flags.json", (route) =>
    route.fulfill({ json: { flags: { "realtime-protocol-stats": true } } })
  );
  await page.route("**/api/v1/pool/stats", (route) =>
    route.fulfill({
      json: {
        totalUsdc: (2_500_000 * 1e7).toString(),
        totalShares: "0",
        lockedUsdc: "0",
        premiumAccrued: "0",
        availableUsdc: "0",
        utilizationBps: 0,
        apyBps: 0,
        sharePrice: 1,
        maxUtilizationBps: 8000,
      },
    })
  );
  await page.route("**/api/v1/claims/stats", (route) =>
    route.fulfill({
      json: {
        activePolicies: 11,
        processedClaims: 0,
        totalPayout: "0",
        settlementConfigured: true,
      },
    })
  );
  await page.routeWebSocket("**/ws", (webSocket) => {
    sockets.push(webSocket);
  });

  await page.goto("/");
  await expect(page.getByText("Policies Active")).toBeVisible();
  expect(sockets).toHaveLength(1);
  sockets[0].send(
    JSON.stringify({
      topic: "protocol.stats",
      sequence: 1,
      timestamp: Date.now(),
      payload: { tvl: (3_200_000 * 1e7).toString(), activePolicies: 31, cumulativePayouts: "0" },
    })
  );
  await expect(page.getByText("31", { exact: true })).toBeVisible();
});
