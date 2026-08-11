import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { boot, bumpCounter, counterLine, ensureTravelOn, FIXTURES_DIR } from "./helpers.js";

/**
 * Session export → import round-trip: the import gate (542bd08) pauses
 * recording, disables travel with an "imported session" tooltip, shows
 * captured-DOM playback while historical, and drops the offline view when
 * recording resumes. A committed protocol-v1 fixture pins the file format.
 */

test("export → import round-trip enters and leaves the offline session view", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export session" }).click(),
  ]);
  const tmp = path.join(FIXTURES_DIR, `_tmp-export-${Date.now()}.json`);
  await download.saveAs(tmp);

  try {
    await page.getByRole("button", { name: "Import session" }).click();
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(tmp);

    await expect(page.locator(".rl-session-label")).toBeVisible();
    await expect(page.locator(".rl-status-rec")).toContainText("paused");

    const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
    await expect(travel).toBeDisabled();
    await expect(travel).toHaveAttribute("title", /imported session/i);

    // Scrub into history so captured-DOM playback surfaces (live mode hides it).
    await page.getByRole("button", { name: "Previous interaction ([)" }).click();
    await expect(page.locator(".rl-tl-domsnap")).toBeVisible();
    await expect(page.locator(".rl-tl-domsnap-hint")).toContainText(/imported session/i);

    // Resume recording + a live interaction drops the offline session view.
    await page.getByRole("button", { name: "Start recording (R)" }).click();
    await expect(page.locator(".rl-status-rec")).toContainText("rec");
    await page.getByRole("button", { name: "count +1" }).click();
    await page.waitForTimeout(350);

    await expect(page.locator(".rl-session-label")).toHaveCount(0);
    await expect(travel).toBeEnabled();
    await ensureTravelOn(page);
    await expect(counterLine(page)).toBeVisible();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test("imports a committed protocol-v1 .lens.json fixture", async ({ page }) => {
  await boot(page);

  const fixture = path.join(FIXTURES_DIR, "minimal.lens.json");
  await page.getByRole("button", { name: "Import session" }).click();
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(fixture);

  await expect(page.locator(".rl-session-label")).toBeVisible();
  await expect(page.locator(".rl-status-rec")).toContainText("paused");
  const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
  await expect(travel).toBeDisabled();
  await expect(travel).toHaveAttribute("title", /imported session/i);

  // Seek historically so the captured DOM snapshot appears.
  const bar = page.locator(".rl-tl-bar-hit").first();
  if ((await bar.count()) > 0) await bar.click();
  else await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".rl-tl-domsnap-hint")).toContainText(/imported session/i);
});
