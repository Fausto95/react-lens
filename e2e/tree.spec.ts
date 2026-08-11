import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

test("arrow keys walk the tree and the inspector follows", async ({ page }) => {
  await boot(page);
  const tree = page.locator(".rl-tree-scroll");
  await tree.focus();

  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("Toolbar");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("Ticker");

  // Left from a leaf jumps to the parent row.
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("Toolbar");
});

test("filter accepts regex, shows a match count, and flags invalid patterns", async ({ page }) => {
  await boot(page);
  const input = page.locator(".rl-tree-search");

  await input.fill("/^Tick/");
  await expect(page.locator(".rl-tree-search-count")).toHaveText("2");
  await expect(page.locator(".rl-tree-name", { hasText: "Ticker" }).first()).toBeVisible();

  await input.fill("/[bad/");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".rl-tree-search-count.invalid")).toHaveText("!");
  await expect(input).toHaveAttribute("title", /invalid regex/i);

  // Structured tokens still work and errors clear.
  await input.fill("renders:>=1 tick");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator(".rl-tree-search-count")).toHaveText("2");
});

test("command palette fuzzy-jumps to a component", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator(".rl-cmdk-input");
  await expect(palette).toBeFocused();
  await palette.fill("hshow"); // fuzzy: H…Showcase
  await expect(page.locator(".rl-cmdk-item.active")).toContainText("HooksShowcase");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("HooksShowcase");
});
