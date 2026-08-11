import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

test("light mode applies from the settings menu and survives a reload", async ({ page }) => {
  await boot(page);

  await page.getByRole("button", { name: "Panel settings" }).click();
  await page.getByRole("radio", { name: "Light" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-rl-theme", "light");
  const bg = await page
    .locator(".rl-root")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");

  await page.reload();
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-rl-theme", "light");

  // Back to dark through the ⌘K palette command.
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".rl-cmdk-input").fill("theme dark");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-rl-theme", "dark");
});
