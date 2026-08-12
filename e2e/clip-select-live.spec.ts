import { test, expect, type Page } from "@playwright/test";
import { boot, bumpCounter, eventCount } from "./helpers.js";

/**
 * Selecting a clip is inspection-only while live. A single click used to move
 * the playhead into historical mode (wave lanes have no stack hit targets),
 * which applies time travel and suppresses recording until go-live.
 *
 * Empty-track / ruler clicks still seek (and travel). This test must hit clips.
 */

/** Click the plot area of a named lane (right of the name gutter). */
async function clickLaneClip(page: Page, laneName: string, xFrac: number): Promise<void> {
  const lane = page.locator(".tl-lname", { hasText: laneName }).first();
  await expect(lane).toBeVisible();
  const laneBox = await lane.boundingBox();
  const canvas = page.locator(".tl-canvas-root canvas").first();
  const canvasBox = await canvas.boundingBox();
  if (!laneBox || !canvasBox) throw new Error("timeline lane/canvas has no box");
  await page.mouse.click(canvasBox.x + canvasBox.width * xFrac, laneBox.y + laneBox.height * 0.5);
}

test("capture continues after tapping the timeline to inspect clips", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);

  // Tap stack / wave clips — must not freeze capture. Empty seeks still travel.
  await clickLaneClip(page, "HooksShowcase", 0.45);
  await clickLaneClip(page, "App", 0.55);
  await clickLaneClip(page, "HooksShowcase", 0.65);

  const afterTaps = await eventCount(page);
  await bumpCounter(page, 1);
  await expect.poll(() => eventCount(page)).toBeGreaterThan(afterTaps);
});
