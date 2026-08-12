import { test, expect } from "@playwright/test";
import { boot, bumpCounter, eventCount, dispatchKey } from "./helpers.js";

/**
 * Recording is always on — R must not pause capture — plus AZERTY keymap
 * regressions at the browser level.
 */

test("recording stays on and keeps capturing after R", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 1);

  // Accidental R used to pause capture while the chrome still looked live.
  await page.keyboard.press("r");
  await expect(page.locator(".rl-status-rec")).toContainText("rec");
  await expect(page.getByLabel("Recording is always on")).toBeVisible();

  const before = await eventCount(page);
  await page.getByRole("button", { name: "count +1" }).click();
  await expect.poll(() => eventCount(page)).toBeGreaterThan(before);
});

test("AZERTY physical brackets and Option+5 step interactions", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);

  await dispatchKey(page, { key: "^", code: "BracketLeft" });
  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");

  await dispatchKey(page, { key: "$", code: "BracketRight" });
  await expect(page.locator(".rl-tl-live-label")).toBeVisible();

  await dispatchKey(page, { key: "[", code: "Digit5", altKey: true });
  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");
});
