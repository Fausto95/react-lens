import { test, expect } from "@playwright/test";
import { boot, bumpCounter, eventCount, dispatchKey } from "./helpers.js";

/**
 * Recording pause (R) and AZERTY keymap regressions at the browser level.
 */

test("R pauses recording so the EV count freezes until resume", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 1);

  await page.keyboard.press("r");
  await expect(page.locator(".rl-status-rec")).toContainText("paused");
  await expect(page.getByRole("button", { name: "Start recording (R)" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Let any in-flight batch settle before sampling the frozen count.
  await page.waitForTimeout(600);
  const before = await eventCount(page);
  const interactionsBefore = await page.locator(".rl-wf-phase").count();

  await page.getByRole("button", { name: "count +1" }).click();
  await page.waitForTimeout(500);
  expect(await eventCount(page)).toBe(before);
  expect(await page.locator(".rl-wf-phase").count()).toBe(interactionsBefore);

  await page.keyboard.press("r");
  await expect(page.locator(".rl-status-rec")).toContainText("rec");
  await page.getByRole("button", { name: "count +1" }).click();
  await page.waitForTimeout(350);
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
