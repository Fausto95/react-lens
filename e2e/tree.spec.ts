import { test, expect } from "@playwright/test";
import { boot, jumpTo } from "./helpers.js";

test("arrow keys walk the tree and the inspector follows", async ({ page }) => {
  await boot(page);
  const tree = page.locator(".rl-tree-scroll");
  await tree.focus();

  await page.keyboard.press("ArrowDown");
  const first = await page.locator(".rl-insp-head h2").textContent();
  expect(first).toBeTruthy();

  await page.keyboard.press("ArrowDown");
  const second = await page.locator(".rl-insp-head h2").textContent();
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);
});

test("filter accepts regex, shows a match count, and flags invalid patterns", async ({ page }) => {
  await boot(page);
  const input = page.locator(".rl-tree-search");

  await input.fill("/^Hooks/");
  await expect(page.locator(".rl-tree-search-count")).not.toHaveText("0");
  await expect(page.locator(".rl-tree-name", { hasText: "HooksShowcase" }).first()).toBeVisible();

  await input.fill("/[bad/");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".rl-tree-search-count.invalid")).toHaveText("!");

  await input.fill("renders:>=1 Hook");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator(".rl-tree-name", { hasText: "HooksShowcase" }).first()).toBeVisible();
});

test("selecting via palette reveals a below-the-fold specimen", async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await jumpTo(page, "BigList");
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
});
