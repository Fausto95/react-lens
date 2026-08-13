import { test, expect } from "@playwright/test";
import { boot, bumpCounter, selectInTree, openSection, propsLine, counterLine } from "./helpers.js";

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

  await rows.nth(0).click();
  const diff = page.locator(".rl-render-diff");
  await expect(diff).toBeVisible();
  await expect(diff.locator(".diff .row").first()).toBeVisible();
});

test("editing a prop in the inspector re-renders the page", async ({ page }) => {
  await boot(page);
  await selectInTree(page, "PropsShowcase");
  await openSection(page, "Props");

  const textRow = page
    .locator(".rl-val-row")
    .filter({ has: page.locator(".rl-val-key", { hasText: /^text$/ }) });
  const input = textRow.locator(".rl-edit-input.rl-t-string");
  await expect(input).toHaveValue("hello world");
  await input.fill("lens e2e");
  await input.blur();

  await expect(propsLine(page)).toContainText("text=lens e2e");
});

test("reducer state shows a read-only badge", async ({ page }) => {
  await boot(page);
  await selectInTree(page, "HooksShowcase");
  await openSection(page, "State");

  const reducerRow = page.locator(".rl-val-row").filter({ hasText: /reducer #/ });
  await expect(reducerRow.locator(".rl-badge.dim", { hasText: "read-only" })).toBeVisible();
  await expect(reducerRow.locator(".rl-edit-input")).toHaveCount(0);
});

test("editing useState in the inspector updates the page counter", async ({ page }) => {
  await boot(page);
  await selectInTree(page, "HooksShowcase");
  await openSection(page, "State");

  const stateInput = page
    .locator(".rl-val-row")
    .filter({ hasText: /state #/ })
    .first()
    .locator(".rl-edit-input");
  await expect(stateInput).toBeVisible();
  await stateInput.fill("7");
  await stateInput.press("Enter");

  await expect(counterLine(page)).toContainText("count 7");
});
