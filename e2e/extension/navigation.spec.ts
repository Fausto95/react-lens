import { test } from "@playwright/test";

/**
 * MV3 extension: same-tab navigations and soft SPA route changes.
 * Invariant: new document gets a fresh session; SPA updates keep the same session.
 */
test.describe("extension navigation", () => {
  test.skip(true, "MV3 extension harness pending");

  test("hard navigation starts a new session; SPA keeps the same one", async () => {
    // Navigate /, then /about (hard) vs pushState (soft); assert session ids.
  });
});
