import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

/**
 * Waste detection: WasteZone forces renders with no DOM change → banner,
 * tree Waste mode listing offenders, and visual-change:false filtering.
 */

test("waste banner, Waste tab, and visual-change:false filter", async ({ page }) => {
  await boot(page);

  await page.getByRole("button", { name: /Force re-render/ }).click();
  const banner = page.locator(".rl-waste-chip");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/wasted/i);

  await banner.locator(".rl-waste-chip-cta", { hasText: "Inspect" }).click();
  await expect(page.getByRole("tab", { name: /Potential Waste|Waste/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Grouped WasteItem ×N shows a suspicious count pip; expand to instance pips.
  await expect(page.locator(".rl-tree-name", { hasText: /^WasteItem/ }).first()).toBeVisible();
  const group = page
    .getByRole("treeitem")
    .filter({ has: page.locator(".rl-tree-name", { hasText: /^WasteItem/ }) })
    .first();
  await expect(group.locator(".rl-badge.render")).toBeVisible();
  await group.locator(".rl-caret").click();
  await expect(page.locator(".rl-pip.waste, .rl-pip.doctor, .rl-pip.warn").first()).toBeVisible();

  await page.getByRole("tab", { name: /Components|All/ }).click();
  const search = page.locator(".rl-tree-search");
  await search.fill("visual-change:false");
  await expect(page.locator(".rl-tree-name", { hasText: /^WasteItem/ }).first()).toBeVisible();
  await expect(page.locator(".rl-tree-search-count")).not.toHaveText("0");
});
