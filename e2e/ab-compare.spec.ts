import { test, expect } from "@playwright/test";
import { boot, bumpCounter, openSection } from "./helpers.js";

/**
 * A/B compare content — not just that marks get set, but that the diff panel
 * lists HooksShowcase and the inspector shows before/after state values.
 */

test("A/B marks around a count change show HooksShowcase diffs", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 1);

  const bars = page.locator(".rl-tl-bar-hit");
  await expect(bars.first()).toBeVisible();
  const count = await bars.count();
  // First commit ≈ pre-bump; last ≈ post-bump (Load … count+1).
  const a = bars.nth(0);
  const b = bars.nth(count - 1);

  await a.click({ modifiers: ["Alt"] });
  await expect(page.locator(".rl-tl-mark.a")).toBeVisible();

  await b.click({ modifiers: ["Shift"] });
  await expect(page.locator(".rl-tl-mark.b")).toBeVisible();

  const abBtn = page.locator(".rl-tl-ab-btn");
  await expect(abBtn).toContainText(/A→B/);
  await abBtn.click();

  const panel = page.locator(".rl-tl-abpanel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".rl-tl-abpanel-row", { hasText: "HooksShowcase" })).toBeVisible();
  await panel.locator(".rl-tl-abpanel-row", { hasText: "HooksShowcase" }).click();

  await expect(page.locator(".rl-insp-head h2")).toHaveText("HooksShowcase");
  await openSection(page, "Compare A ↔ B");
  const ab = page.locator(".rl-ab");
  await expect(ab).toBeVisible();
  await expect(ab.locator(".rl-diff-line").first()).toBeVisible();
  await expect(ab).toContainText(/→/);
});
