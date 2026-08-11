import { test, expect } from "@playwright/test";
import { boot, selectInTree, openSection, propsLine, counterLine } from "./helpers.js";

/**
 * Live value editing is the setProp / setHookState seam end-to-end: change a
 * value in the inspector and the page must re-render with it. The same journey
 * covers the reducer "read-only" badge on HooksShowcase.
 */

test("editing a prop in the inspector re-renders the page", async ({ page }) => {
  await boot(page);
  await selectInTree(page, "PropsShowcase");
  await openSection(page, "Props");

  const textRow = page.locator(".rl-val-row").filter({ has: page.locator(".rl-val-key", { hasText: /^text$/ }) });
  const input = textRow.locator(".rl-edit-input.rl-t-string");
  await expect(input).toHaveValue("hello world");
  await input.fill("lens e2e");
  await input.blur();

  await expect(propsLine(page)).toContainText("text=lens e2e");
});

test("editing useState in the inspector rewinds the page counter", async ({ page }) => {
  await boot(page);
  await bumpAndSelect(page);

  await openSection(page, "State");
  // First state hook is the count useState (reducer follows with a read-only badge).
  const stateInput = page.locator(".rl-val-row").filter({ hasText: /state #/ }).first().locator(".rl-edit-input");
  await expect(stateInput).toBeVisible();
  await stateInput.fill("7");
  await stateInput.press("Enter");

  await expect(counterLine(page)).toContainText("count 7");
});

test("reducer state shows a read-only badge and is not editable", async ({ page }) => {
  await boot(page);
  await selectInTree(page, "HooksShowcase");
  await openSection(page, "State");

  const reducerRow = page.locator(".rl-val-row").filter({ hasText: /reducer #/ });
  await expect(reducerRow.locator(".rl-badge.dim", { hasText: "read-only" })).toBeVisible();
  await expect(reducerRow.locator(".rl-edit-input")).toHaveCount(0);
  await expect(reducerRow.locator(".rl-badge.dim")).toHaveAttribute(
    "title",
    /bypass the reducer/i,
  );
});

async function bumpAndSelect(page: import("@playwright/test").Page): Promise<void> {
  // Mount selection alone is enough — count starts at 0 and is editable.
  await selectInTree(page, "HooksShowcase");
}
