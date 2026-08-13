import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

test("light mode applies from settings and survives a reload", async ({ page }) => {
  await boot(page);

  await page.getByRole("button", { name: "Panel settings" }).click();
  await page.getByRole("radio", { name: "Light" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-rl-theme", "light");
  const bg = await page.locator(".rl-root").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");

  await page.reload();
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-rl-theme", "light");
});

test("dock width survives a reload", async ({ page }) => {
  await boot(page);

  const root = page.locator(".rl-root.rl-embedded");
  const handle = page.locator(".rl-resize-handle");
  const beforeWidth = await root.evaluate((el) => el.getBoundingClientRect().width);

  const hBox = await handle.boundingBox();
  if (!hBox) throw new Error("dock resize handle missing");
  await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hBox.x - 80, hBox.y + hBox.height / 2, { steps: 8 });
  await page.mouse.up();

  const afterWidth = await root.evaluate((el) => el.getBoundingClientRect().width);
  expect(afterWidth).toBeGreaterThan(beforeWidth + 40);

  await page.reload();
  await expect(page.locator(".rl-root")).toBeVisible();

  const reloadedWidth = await page
    .locator(".rl-root.rl-embedded")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(reloadedWidth - afterWidth)).toBeLessThan(3);
});
