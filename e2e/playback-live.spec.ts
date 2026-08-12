import { test, expect } from "@playwright/test";
import { boot, bumpCounter, ensureTravelOn, eventCount } from "./helpers.js";

/**
 * Playing the session back must hand the cursor back to the present.
 *
 * Scrubbing applies time travel on the page, and while travel is active the
 * instrumentation drops every commit — that is what keeps the rewound UI out of
 * the log. A finished play-once used to leave the cursor "historical", so
 * travel stayed applied and capture never came back: after a replay, nothing
 * was traced again.
 */

test("capture resumes after a play-once reaches the present", async ({ page }) => {
  await boot(page);
  await ensureTravelOn(page);
  await bumpCounter(page, 3);

  await page.locator(".rl-timeline, .tl-root").first().click({ position: { x: 10, y: 10 } });
  await page.getByRole("button", { name: /play/i }).first().click();

  // Play-once ends at the present and the status returns to live.
  await expect(page.locator(".rl-status-rec")).toContainText("rec");
  await expect
    .poll(async () => page.locator(".tl-btn.on").count(), { timeout: 15_000 })
    .toBe(0);

  const before = await eventCount(page);
  await page.getByRole("button", { name: "count +1" }).click();
  await expect.poll(() => eventCount(page)).toBeGreaterThan(before);
});
