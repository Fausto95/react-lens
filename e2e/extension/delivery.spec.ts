import { test, expect } from "@playwright/test";
import { extensionReady, launchWithExtension, openFixtureTab } from "../helpers/extension.js";

/**
 * MV3 extension: content script → background → panel delivery of every frame.
 * Invariant: no silent drops under load; ordering preserved per session.
 *
 * Full CDP DevTools-panel attachment is still pending; when the unpacked
 * extension is built (`E2E_EXTENSION_BUILT=1` or `E2E_EXTENSION_PATH`), this
 * smoke-loads Chromium with --load-extension and asserts the fixture page
 * stays healthy under the content script.
 */
test.describe("extension delivery", () => {
  test.skip(!extensionReady(), "Set E2E_EXTENSION_BUILT=1 after pnpm build:extension");

  test("fixture page loads with the unpacked extension without throwing", async () => {
    const { context } = await launchWithExtension();
    try {
      const page = await openFixtureTab(context);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await expect(page.getByRole("heading", { name: /E2E Fixture/i })).toBeVisible();
      await page.getByRole("button", { name: "count +1" }).click();
      expect(errors, errors.join("\n")).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
