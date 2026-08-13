import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

test("reported error surfaces the ErrorChip", async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    (window as unknown as { __lensReportError: (msg: string) => void }).__lensReportError(
      "e2e intentional fault",
    );
  });

  await expect(page.locator(".rl-error-chip")).toBeVisible({ timeout: 5_000 });
  await page.locator(".rl-error-chip").click();
  await expect(page.getByRole("dialog", { name: /React Lens errors/i })).toBeVisible();
  await expect(page.locator(".rl-error-list")).toContainText(/e2e intentional fault/);
});
