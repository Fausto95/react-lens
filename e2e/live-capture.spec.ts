import { test, expect, type Page } from "@playwright/test";
import { eventCount } from "./helpers.js";

/**
 * The panel must keep showing what the page does after the first commit.
 *
 * The trace store was still ingesting — instrumentation emitted frames for
 * every interaction — but the panel's render-time reads of it (`store.stats()`,
 * `sessionSpanMs(store)`) depend only on `store`, whose identity never changes.
 * Compiled by the React Compiler, those reads were cached once at mount, so the
 * whole panel showed the mount forever and every later event looked lost.
 */

/**
 * Click a page button. Dispatched through the element: the embedded panel docks
 * over the demo, so Playwright's hit-testing sees it covered.
 */
async function clickInPage(page: Page, label: string): Promise<void> {
  await page
    .getByRole("button", { name: label })
    .first()
    .evaluate((el: HTMLElement) => el.click());
}

test("the panel keeps counting events after the initial mount", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.locator(".rl-tree-name", { hasText: /^Storefront$/ }).first()).toBeVisible();

  const mounted = await eventCount(page);
  expect(mounted).toBeGreaterThan(0);

  await clickInPage(page, "Refresh prices");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(mounted);

  const afterRefresh = await eventCount(page);
  await clickInPage(page, "Add");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(afterRefresh);
});
