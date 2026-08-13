import { defineConfig, devices } from "@playwright/test";

/**
 * Perf / scale suite — longer timeouts, focused on viewport-bounded work.
 * Run: `pnpm exec playwright test -c playwright.perf.config.ts`
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /perf-scale\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5173",
    trace: "off",
  },
  webServer: {
    command: "pnpm --filter @reactlens/playground dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
