import { test, expect } from "@playwright/test";
import { boot, bumpCounter } from "./helpers.js";

test("zoom readout tracks the level and resets to fit", async ({ page }) => {
  await boot(page);
  const readout = page.locator(".rl-tl-zoom-level");
  await expect(readout).toHaveText("fit");

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(readout).toHaveText(/%$/);

  await readout.click();
  await expect(readout).toHaveText("fit");
});

test("double-clicking a commit brackets it with A/B and opens the diff", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 1);

  // The first commit sits away from the live playhead, which would otherwise
  // intercept the double-click on the newest one.
  await page.locator(".rl-tl-bar-hit").first().dblclick();
  await expect(page.locator(".rl-tl-ab-btn")).toContainText("A→B");
  await expect(page.locator(".rl-tl-mark.a")).toBeVisible();
  await expect(page.locator(".rl-tl-mark.b")).toBeVisible();
});

test("footer metrics are live and actionable", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".rl-status-rec")).toContainText("rec");

  // RND seeks the heaviest commit → cursor leaves LIVE.
  await page.locator('button[title*="heaviest commit"]').click();
  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");
});
