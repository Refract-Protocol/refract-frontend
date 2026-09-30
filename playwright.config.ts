import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Refract's critical-path E2E coverage.
 *
 * Runs headless Chromium against a locally-built Next.js app. The app is
 * started with `next dev` so the suite works in CI without a prebuilt
 * artifact; the wallet is mocked via `e2e/fixtures.ts` (see that file for
 * why we inject `window.freighterApi` rather than a real extension).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? ["github", "list"] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
