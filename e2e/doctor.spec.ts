import { test, expect } from "@playwright/test";
import { boot, clickInPage, interactionRows, jumpTo, openSection } from "./helpers.js";

test("Force re-render records a large cascade and surfaces Doctor", async ({ page }) => {
  await boot(page);
  await clickInPage(page, /Force re-render/);

  await expect
    .poll(
      async () => {
        const selected = page.locator(".rl-cascade-interaction.selected .meta");
        if ((await selected.count()) === 0) return "";
        return selected.innerText();
      },
      { timeout: 10_000 },
    )
    .toMatch(/(\d+)\s+renders/);

  const meta = await page.locator(".rl-cascade-interaction.selected .meta").innerText();
  const renders = Number(/(\d+)\s+renders/.exec(meta)?.[1] ?? 0);
  expect(renders).toBeGreaterThan(10);

  await expect.poll(async () => interactionRows(page).count()).toBeGreaterThan(0);
});

test("Doctor lists findings with severity after wasted re-renders", async ({ page }) => {
  await boot(page);

  for (let i = 0; i < 4; i++) {
    await clickInPage(page, /Force re-render/);
    await page.waitForTimeout(400);
  }

  await jumpTo(page, "WasteItem");
  await openSection(page, "Doctor");

  const strip = page.locator(".rl-doc-strip").first();
  await expect(strip).toBeVisible({ timeout: 20_000 });
  await expect(strip.locator(".rl-doc-sev-pip")).toHaveAttribute("title", /severe|suspicious|warn/);
  await expect(strip.locator(".rl-doc-title")).not.toHaveText("");
});

test("Doctor menu lists evidence and a next step", async ({ page }) => {
  await boot(page);

  for (let i = 0; i < 4; i++) {
    await clickInPage(page, /Force re-render/);
    await page.waitForTimeout(400);
  }

  const badge = page.getByRole("button", { name: /Doctor issues/ });
  await expect(badge).toBeEnabled({ timeout: 20_000 });
  await badge.click();

  const issue = page.locator(".rl-doctor-issue").first();
  await expect(issue).toBeVisible();
  await expect(issue.locator(".rl-doctor-issue-detail")).not.toHaveText("");
  await expect(issue.locator(".rl-doctor-issue-next")).toContainText(/Next:/);
});

test("Fix-with-AI stages the question when no API key is set", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => localStorage.removeItem("react-lens/agent-settings"));

  for (let i = 0; i < 4; i++) {
    await clickInPage(page, /Force re-render/);
    await page.waitForTimeout(400);
  }

  await jumpTo(page, "WasteItem");
  await openSection(page, "Doctor");

  const fix = page.locator(".rl-fix-ai").first();
  if ((await fix.count()) > 0) {
    await fix.click();
  } else {
    await page.getByRole("button", { name: "AI assistant (⌘I)" }).click();
    const drawer = page.locator(".rl-agent");
    await drawer.locator("textarea").fill("Why is WasteItem wasting renders?");
    await drawer.getByRole("button", { name: "Ask" }).click();
  }

  const drawer = page.locator(".rl-agent");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".rl-agent-error")).toContainText(/API key/i);
});
