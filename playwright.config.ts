import { defineConfig } from "@playwright/test";

/**
 * E2E against apps/e2e-fixture: embedded panel + MV3 extension project.
 * Ports default to 5201/5202 to avoid colliding with hung 5198/5199 listeners.
 */
const PORT = Number(process.env.E2E_PORT ?? 5201);
const PROD_PORT = Number(process.env.E2E_PROD_PORT ?? 5202);

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    viewport: { width: 1500, height: 950 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "embed",
      testMatch: /^(?!.*\/extension\/).*\.spec\.ts$/,
      testIgnore: /perf-scale\.spec\.ts$/,
      use: { baseURL: `http://localhost:${PORT}` },
    },
    {
      name: "extension",
      testMatch: /extension\/.*\.spec\.ts$/,
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @reactlens/e2e-fixture exec vp dev --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        `pnpm --filter @reactlens/e2e-fixture build --sourcemap && ` +
        `pnpm --filter @reactlens/e2e-fixture exec vp preview --port ${PROD_PORT} --strictPort`,
      url: `http://localhost:${PROD_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
