import { test } from "@playwright/test";

/**
 * MV3 extension: service worker kill / port disconnect must recover the session.
 * Invariant: after reconnect, capture resumes and prior WAL frames are available.
 */
test.describe("extension reconnect", () => {
  test.skip(true, "MV3 extension harness pending");

  test("killing the service worker reconnects and resumes capture", async () => {
    // chrome.debugger / CDP: terminate SW, wait for rebind, bump counter, assert.
  });
});
