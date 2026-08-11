import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

/**
 * Render overlay flashes on commit while enabled, and stops after disabling.
 */

test("render overlay flashes on commit and clears when disabled", async ({ page }) => {
  await boot(page);

  await page.getByRole("button", { name: "Panel settings" }).click();
  await page.getByRole("switch", { name: "Render overlay" }).click();
  await page.keyboard.press("Escape");

  // Heavy work makes flash elements easier to catch before the 420ms fade.
  await page.getByRole("button", { name: /Re-render/ }).click();
  await expect
    .poll(async () => page.locator("#react-lens-render-overlay div").count(), { timeout: 8_000 })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Panel settings" }).click();
  await page.getByRole("switch", { name: "Render overlay" }).click();
  await page.keyboard.press("Escape");

  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Re-render/ }).click();
  await page.waitForTimeout(700);
  await expect(page.locator("#react-lens-render-overlay > div")).toHaveCount(0);
});
