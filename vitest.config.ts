import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // happy-dom for the DOM-snapshot diff tests; pure packages ignore it.
    environment: "happy-dom",
    include: ["packages/**/*.test.ts"],
    passWithNoTests: true,
  },
});
