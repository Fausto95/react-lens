import { test, expect } from "@playwright/test";
import { boot, bumpCounter, selectInTree, openSection } from "./helpers.js";

test("renders feed lists newest first and expands with the diff", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);
  await selectInTree(page, "HooksShowca");
  await openSection(page, "Renders");

  const rows = page.locator(".rl-render-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("#3");
  await expect(rows.nth(2)).toContainText("#1");
  await expect(rows.nth(2).locator(".rl-render-chip")).toContainText("mount");

  // Newest render expands with the state diff vs the previous one.
  await rows.nth(0).click();
  const diff = page.locator(".rl-render-diff");
  await expect(diff).toBeVisible();
  await expect(diff.locator(".rl-render-diff-head").first()).toContainText("State");

  // The mount render shows its initial props instead of "nothing to compare".
  await rows.nth(2).click();
  await expect(page.locator(".rl-render-diff-head").first()).toContainText("Mount");
});

test("header file:line opens through the dev server's editor middleware", async ({ page }) => {
  await boot(page);
  const opened: string[] = [];
  await page.route("**/__open-in-editor**", (route) => {
    opened.push(route.request().url());
    void route.fulfill({ status: 200, body: "" });
  });

  await selectInTree(page, "HooksShowca");
  await page.locator(".rl-insp-source-link").click();

  await expect.poll(() => opened).toHaveLength(1);
  const file = new URL(opened[0]!).searchParams.get("file")!;
  // Server-relative source path with a line:column — the server resolves the
  // absolute path on disk, so the editor never sees "/App.tsx".
  expect(file).toMatch(/^src\/.+\.tsx:\d+:\d+$/);
});

test("stack relations navigate between components", async ({ page }) => {
  await boot(page);
  await selectInTree(page, "App");
  await openSection(page, "Stack");

  await page.locator(".rl-rel-item.link", { hasText: "Toolbar" }).click();
  await expect(page.locator(".rl-insp-head h2")).toHaveText("Toolbar");

  // And back up through its parent.
  await openSection(page, "Stack");
  await page.locator(".rl-rel-item.link", { hasText: "App" }).first().click();
  await expect(page.locator(".rl-insp-head h2")).toHaveText("App");
});
