import { test } from "@playwright/test";

/**
 * MV3 extension: poisoned / oversized / truncated messages must not kill the port.
 * Invariant: bad frames are dropped with a notice; good frames keep flowing.
 */
test.describe("extension poison", () => {
  test.skip(true, "MV3 extension harness pending");

  test("malformed frames are dropped without killing the connection", async () => {
    // Inject garbage into the content→background channel; assert ErrorChip notice + recovery.
  });
});
