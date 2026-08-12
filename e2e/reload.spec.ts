import { test, expect } from "@playwright/test";
import { boot, bumpCounter, eventCount } from "./helpers.js";

/**
 * A reload starts a new trace session. Every id factory lives in the inspected
 * page and restarts at 1 on each document load, so a panel that kept the
 * previous document's log dropped the new one's renders as "already seen" —
 * the panel looked dead after a reload.
 */

test("a reload starts a clean session and keeps capturing", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);
  expect(await eventCount(page)).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.locator(".rl-tree-name", { hasText: /^App$/ }).first()).toBeVisible();

  // The mount of the new document is captured, not swallowed by stale ids.
  const afterMount = await eventCount(page);
  expect(afterMount).toBeGreaterThan(0);

  await page.getByRole("button", { name: "count +1" }).click();
  await expect.poll(() => eventCount(page)).toBeGreaterThan(afterMount);
});
