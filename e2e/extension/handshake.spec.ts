import { test } from "@playwright/test";

/**
 * MV3 extension: renderer handshake before first frame.
 * Invariant: panel never shows an empty tree while the page has already mounted React.
 */
test.describe("extension handshake", () => {
  test.skip(true, "MV3 extension harness pending");

  test("panel is live by the time the page's first commit lands", async () => {
    // Race: open panel late vs early; assert HooksShowcase appears without manual refresh.
  });
});
