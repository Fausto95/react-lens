import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

/**
 * Panel ergonomics: dock resize + tree/inspector splitter persist across reload.
 */

test("dock and splitter widths survive a reload", async ({ page }) => {
  await boot(page);

  const root = page.locator(".rl-root.rl-embedded");
  const handle = page.locator(".rl-resize-handle");
  const splitter = page.locator(".rl-resizer");

  const beforeWidth = await root.evaluate((el) => el.getBoundingClientRect().width);
  const body = page.locator(".rl-body");
  const beforeSplit = await body.evaluate((el) => getComputedStyle(el).gridTemplateColumns);

  // Widen the dock (drag handle left).
  const hBox = await handle.boundingBox();
  if (!hBox) throw new Error("dock resize handle missing");
  await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hBox.x - 80, hBox.y + hBox.height / 2, { steps: 8 });
  await page.mouse.up();

  const afterWidth = await root.evaluate((el) => el.getBoundingClientRect().width);
  expect(afterWidth).toBeGreaterThan(beforeWidth + 40);

  // Move the tree/inspector split.
  const sBox = await splitter.boundingBox();
  if (!sBox) throw new Error("pane splitter missing");
  await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sBox.x - 60, sBox.y + sBox.height / 2, { steps: 8 });
  await page.mouse.up();

  const afterSplit = await body.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  expect(afterSplit).not.toBe(beforeSplit);

  await page.reload();
  await expect(page.locator(".rl-root")).toBeVisible();

  const reloadedWidth = await page
    .locator(".rl-root.rl-embedded")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(reloadedWidth - afterWidth)).toBeLessThan(3);

  const reloadedSplit = await page
    .locator(".rl-body")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  // First column (tree %) should match the dragged split.
  const col = (s: string) => Number.parseFloat(s.split(" ")[0] ?? "0");
  expect(Math.abs(col(reloadedSplit) - col(afterSplit))).toBeLessThan(2);
});
