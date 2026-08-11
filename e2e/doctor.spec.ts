import { test, expect } from "@playwright/test";
import { boot, bumpCounter, jumpTo, openSection } from "./helpers.js";

/**
 * Doctor findings (WasteItem after wasted re-renders), Fix-with-AI staging
 * without a network call, and the non-AI explain narrative path.
 */

test("Doctor lists findings with severity after wasted re-renders", async ({ page }) => {
  await boot(page);

  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: /Force re-render/ }).click();
    await page.waitForTimeout(400);
  }

  await jumpTo(page, "WasteItem");
  await openSection(page, "Doctor");

  const strip = page.locator(".rl-doc-strip").first();
  await expect(strip).toBeVisible({ timeout: 20_000 });
  await expect(strip.locator(".rl-doc-sev-pip")).toHaveAttribute("title", /severe|suspicious|warn/);
  await expect(strip.locator(".rl-doc-title")).not.toHaveText("");
  await expect(page.locator(".rl-fix-ai").first()).toBeVisible();
});

test("Fix-with-AI stages the question when no API key is set", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => localStorage.removeItem("react-lens/agent-settings"));

  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /Re-render/ }).click();
    await page.waitForTimeout(400);
  }

  await page.locator(".rl-tree-search").fill("Heavy");
  const fix = page.locator(".rl-fix-ai").first();
  await expect(fix).toBeVisible({ timeout: 10_000 });
  await fix.click();

  const drawer = page.locator(".rl-agent");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".rl-agent-error")).toContainText(/API key/i);
  await expect(drawer.locator("textarea")).not.toHaveValue("");
});

test("? opens the local NarrativeCard and citation chips seek the cursor", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);

  await page.getByRole("button", { name: "Previous interaction ([)" }).click();
  await expect(page.locator(".rl-tl-card-title")).toBeVisible();

  await page.keyboard.press("?");
  const narrative = page.locator(".rl-narrative");
  await expect(narrative).toBeVisible();
  await expect(narrative.locator(".rl-narrative-headline")).not.toHaveText("");

  const renderChip = narrative.locator(".rl-narrative-chip", { hasText: /^r\d+/ }).first();
  if ((await renderChip.count()) > 0) {
    await renderChip.click();
    await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");
  } else {
    await narrative.locator(".rl-narrative-chip").first().click();
  }
});
