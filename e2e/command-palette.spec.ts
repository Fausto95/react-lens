import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

test("command palette fuzzy-jumps to a component", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator(".rl-cmdk-input");
  await expect(palette).toBeFocused();
  await palette.fill("hshow");
  await expect(page.locator(".rl-cmdk-item.active")).toContainText("HooksShowcase");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("HooksShowcase");
});

test("palette theme command switches to dark", async ({ page }) => {
  await boot(page);

  await page.getByRole("button", { name: "Panel settings" }).click();
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-rl-theme", "light");
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".rl-cmdk-input").fill("theme dark");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-rl-theme", "dark");
});
