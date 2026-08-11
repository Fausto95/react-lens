import { defineConfig } from "@playwright/test";

/**
 * E2E against the playground: the embedded panel exercises the whole pipeline
 * (instrumentation → trace store → causality → UI) plus real time travel on a
 * live React app. A dedicated port keeps runs isolated from dev servers.
 */
const PORT = 5199;
/** Minified production build, served from dist — the prod-source specs. */
const PROD_PORT = 5198;

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: true,
  // The playground mounts ~900 components per page; more workers starve the
  // machine into flaky boot timeouts.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1500, height: 950 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `pnpm --filter @reactlens/playground exec vp dev --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
    },
    {
      // A genuine production bundle: minified names, no dev-only fiber fields,
      // sourcemaps deployed so the panel can symbolicate what it locates.
      command:
        `pnpm --filter @reactlens/playground build --sourcemap && ` +
        `pnpm --filter @reactlens/playground exec vp preview --port ${PROD_PORT} --strictPort`,
      url: `http://localhost:${PROD_PORT}`,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      timeout: 120_000,
    },
  ],
});
