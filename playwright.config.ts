import { defineConfig } from "@playwright/test";

/**
 * E2E against the playground: the embedded panel exercises the whole pipeline
 * (instrumentation → trace store → causality → UI) plus real time travel on a
 * live React app. A dedicated port keeps runs isolated from dev servers.
 */
const PORT = 5199;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // The playground mounts ~900 components per page; more workers starve the
  // machine into flaky boot timeouts.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1500, height: 950 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm --filter @react-lens/playground exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
