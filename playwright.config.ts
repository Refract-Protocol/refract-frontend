import { defineConfig, devices } from "@playwright/test";

/**
 * Realtime E2E orchestration:
 * - The Next app boots with realtime enabled (NEXT_PUBLIC_REALTIME_ENABLED=1)
 *   and points at the local mock realtime server.
 * - The mock realtime server runs on its own port (REALTIME_MOCK_PORT, default
 *   4001) so it never collides with the dev backend on 3000.
 * - Both are started via `webServer` so Playwright tears them down between runs.
 */
const APP_PORT = 3000;
const MOCK_PORT = Number(process.env.REALTIME_MOCK_PORT ?? 4001);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

const realtimeEnv = {
  NEXT_PUBLIC_REALTIME_ENABLED: "1",
  NEXT_PUBLIC_REALTIME_URL: MOCK_URL,
  REALTIME_MOCK_PORT: String(MOCK_PORT),
};

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
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? APP_URL,
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
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: "npm run mock:realtime",
          url: `${MOCK_URL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: realtimeEnv,
        },
        {
          command: "npm run dev",
          url: APP_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: realtimeEnv,
        },
      ],
});
