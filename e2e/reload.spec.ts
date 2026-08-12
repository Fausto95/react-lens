import { test, expect } from "@playwright/test";
import { eventCount } from "./helpers.js";

/**
 * A reload starts a new trace session. Every id factory lives in the inspected
 * page and restarts at 1 on each document load, so a panel that kept the
 * previous document's log dropped the new one's renders as "already seen" —
 * the panel looked dead after a reload.
 */

/** Load the playground and wait for the panel's first commit to land. */
async function bootPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.locator(".rl-tree-name", { hasText: /^Storefront$/ }).first()).toBeVisible();
}

/**
 * Click a page button. Dispatched rather than hit-tested: the embedded panel
 * docks over the demo, so Playwright's actionability check sees it covered.
 */
const refresh = (page: import("@playwright/test").Page) =>
  page
    .getByRole("button", { name: "Refresh prices" })
    .evaluate((el: HTMLElement) => el.click());

test("a reload starts a clean session and keeps capturing", async ({ page }) => {
  await bootPanel(page);
  await refresh(page);
  await expect.poll(() => eventCount(page)).toBeGreaterThan(0);

  await page.reload();
  await bootPanel(page);

  // The mount of the new document is captured, not swallowed by stale ids.
  const afterMount = await eventCount(page);
  expect(afterMount).toBeGreaterThan(0);

  await refresh(page);
  await expect.poll(() => eventCount(page)).toBeGreaterThan(afterMount);
});
