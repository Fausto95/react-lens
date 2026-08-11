import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

/**
 * Timeline LOD: +N more expands packed rows; cluster chips appear when bars
 * are sub-threshold after zooming out of a dense burst (WasteZone).
 */

test("waterfall +N more chip expands a deep phase", async ({ page }) => {
  await boot(page);

  await page.getByRole("button", { name: /Force re-render/ }).click();
  await page.waitForTimeout(500);

  const more = page.locator(".rl-wf-more").first();
  await expect(more).toBeVisible({ timeout: 10_000 });
  await expect(more).toHaveText(/\+\d+ more/);

  await more.click();
  await expect(more).toHaveText(/show less/i);
});

test("LOD cluster chip appears when zoomed out of a dense burst", async ({ page }) => {
  await boot(page);

  for (let i = 0; i < 8; i++) {
    await page.getByRole("button", { name: /Force re-render/ }).click();
    await page.waitForTimeout(120);
  }

  // Fit latest phase, then zoom out until lane-mates collapse into a cluster.
  await page.locator(".rl-wf-phase").last().dblclick();
  await page.waitForTimeout(150);

  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  await expect
    .poll(
      async () => {
        if ((await page.locator(".rl-wf-cluster").count()) > 0) return 1;
        await zoomOut.click();
        return 0;
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(1);

  const cluster = page.locator(".rl-wf-cluster").first();
  await expect(cluster).toHaveText(/×\d+/);
  await cluster.click();
  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");
});
