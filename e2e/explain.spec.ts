import { test, expect } from "@playwright/test";
import { boot, bumpCounter, selectInTree, openSection } from "./helpers.js";

/**
 * Local explain path: the inspector Why section narrates the selected render
 * (NarrativeCard was unwired in the timeline redesign).
 */
test("Why section narrates the selected component after interaction", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);
  await selectInTree(page, "HooksShowca");
  await openSection(page, "Why");

  const why = page.locator(".isect").filter({ has: page.locator(".ihead", { hasText: "Why" }) });
  await expect(why).toBeVisible();
  await expect(why).not.toHaveText(/^\s*$/);
  // Verdict / cause copy should mention a known reason class.
  await expect(why).toContainText(/state|props|mount|change|render/i);
});
