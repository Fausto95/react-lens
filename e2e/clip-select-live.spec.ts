import { test, expect, type Page } from "@playwright/test";
import { boot, bumpCounter, eventCount } from "./helpers.js";

/**
 * Selecting a clip is inspection-only while live. A single click used to move
 * the playhead into historical mode (wave lanes have no stack hit targets),
 * which applies time travel and suppresses recording until go-live.
 */

async function clickTimeline(page: Page, xFrac: number, yFrac: number): Promise<void> {
  const canvas = page.locator(".tl-canvas-root canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("timeline canvas has no box");
  await page.mouse.click(box.x + box.width * xFrac, box.y + box.height * yFrac);
}

test("capture continues after tapping the timeline to inspect clips", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);

  // Tap several places (stack clips and/or wave lanes) — must not freeze capture.
  await clickTimeline(page, 0.35, 0.45);
  await clickTimeline(page, 0.55, 0.55);
  await clickTimeline(page, 0.4, 0.7);

  const afterTaps = await eventCount(page);
  await bumpCounter(page, 1);
  await expect.poll(() => eventCount(page)).toBeGreaterThan(afterTaps);
});
