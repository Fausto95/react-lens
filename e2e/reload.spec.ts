import { test, expect } from "@playwright/test";
import { eventCount, clickInPage } from "./helpers.js";

/**
 * A reload starts a new trace session. Id factories restart at 1; a panel that
 * kept the previous document's log would drop new renders as "already seen".
 */

async function bootPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.locator(".rl-tree-name", { hasText: /^HooksShowcase$/ }).first()).toBeVisible();
}

test("a reload starts a clean session and keeps capturing", async ({ page }) => {
  await bootPanel(page);
  await clickInPage(page, "Refresh prices");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(0);

  await page.reload();
  await bootPanel(page);

  const afterMount = await eventCount(page);
  expect(afterMount).toBeGreaterThan(0);

  await clickInPage(page, "Refresh prices");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(afterMount);
});
