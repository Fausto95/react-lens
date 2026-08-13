import { test } from "@playwright/test";

/**
 * MV3 extension: write-ahead log survives SW death and panel close.
 * Invariant: reopen panel → WAL hydrate → continuous timeline, no gap at the seam.
 */
test.describe("extension WAL", () => {
  test.skip(true, "MV3 extension harness pending");

  test("WAL hydrates after panel reopen without a timeline gap", async () => {
    // Capture → close panel → reopen → assert event continuity across the seam.
  });
});
