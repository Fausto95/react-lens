import { test, expect } from "@playwright/test";
import { boot, clickInPage, eventCount } from "./helpers.js";

test("the panel keeps counting events after the initial mount", async ({ page }) => {
  await boot(page);

  const mounted = await eventCount(page);
  expect(mounted).toBeGreaterThan(0);

  await clickInPage(page, "Refresh prices");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(mounted);

  const afterRefresh = await eventCount(page);
  await clickInPage(page, "Add");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(afterRefresh);
});

test("recording stays on and keeps capturing after R", async ({ page }) => {
  await boot(page);
  const before = await eventCount(page);

  await page.keyboard.press("r");
  await expect(page.locator(".rl-status-rec")).toContainText("rec");

  await clickInPage(page, "count +1");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(before);
});
