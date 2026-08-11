import { test, expect } from "@playwright/test";
import { boot, bumpCounter, counterLine, ensureTravelOn } from "./helpers.js";

/**
 * Playhead scrubbing contract: with travel on, dragging the playhead drives
 * the page; with travel off, scrubbing only moves panel views.
 */

async function ensureTimelineOpen(page: import("@playwright/test").Page): Promise<void> {
  const tl = page.locator(".rl-tl");
  if (await tl.evaluate((el) => el.classList.contains("rl-tl-collapsed"))) {
    await page.keyboard.press("t");
  }
  await expect(page.locator(".rl-tl-playhead")).toBeVisible();
}

test("dragging the playhead with travel on rewinds the page", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);
  await ensureTravelOn(page);
  await ensureTimelineOpen(page);

  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Zoom in" }).click();

  const hit = page.locator(".rl-tl-playhead-hit");
  const track = page.locator(".rl-tl-track-react");
  await hit.dragTo(track, { targetPosition: { x: 48, y: 8 }, force: true });

  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");
  await expect(counterLine(page)).not.toContainText("count 3");
});

test("with travel off, scrubbing moves the panel but never the page", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);
  await ensureTimelineOpen(page);

  const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
  await expect(travel).toBeEnabled();
  if ((await travel.getAttribute("aria-pressed")) === "true") await travel.click();
  await expect(travel).toHaveAttribute("aria-pressed", "false");
  await expect(travel).toHaveAttribute("title", /only moves the panel/i);

  await expect(counterLine(page)).toContainText("count 3");

  await page.getByRole("button", { name: "Previous interaction ([)" }).click();
  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");
  await expect(counterLine(page)).toContainText("count 3");

  await page.getByRole("button", { name: "Previous interaction ([)" }).click();
  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");
  await expect(counterLine(page)).toContainText("count 3");
});
