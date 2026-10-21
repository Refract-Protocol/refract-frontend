import { defineConfig, devices } from "@playwright/test";

/**
  reporter: process.env.CI ? ["github", "list"] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
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
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: [
    // Deterministic mock realtime server on a fixed port for browser tests.
    {
      command: "node scripts/mock-realtime-server.mjs --port=4010",
      port: 4010,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    ...(process.env.PLAYWRIGHT_BASE_URL
      ? []
      : [
          {
            command: "npm run dev",
            url: "http://127.0.0.1:3000",
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]),
  ],
});
