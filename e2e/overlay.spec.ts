import { test, expect } from "@playwright/test";
import { boot, clickInPage } from "./helpers.js";

test("render overlay flashes on commit and clears when disabled", async ({ page }) => {
  await boot(page);

  await page.getByRole("button", { name: "Panel settings" }).click();
  await page.getByRole("switch", { name: "Render overlay" }).click();
  await page.keyboard.press("Escape");

  await clickInPage(page, /Force re-render/);
  await expect
    .poll(async () => page.locator("#react-lens-render-overlay div").count(), { timeout: 8_000 })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Panel settings" }).click();
  await page.getByRole("switch", { name: "Render overlay" }).click();
  await page.keyboard.press("Escape");

  await page.waitForTimeout(500);
  await clickInPage(page, /Force re-render/);
  await page.waitForTimeout(700);
  await expect(page.locator("#react-lens-render-overlay > div")).toHaveCount(0);
});
