import { test, expect } from "@playwright/test";
import { boot, collapsePane, expandPane, selectCascadeLens } from "./helpers.js";

/**
 * The panel is two columns now — Cascade and Inspector. The Components pane is
 * gone; ⌘K reaches components (see `selectComponent`) and the Doctor's warnings
 * travel with the component in the lenses.
 */

test("Inspector pane collapses to a rail and expands back", async ({ page }) => {
  await boot(page);
  await expect(page.getByRole("button", { name: "Collapse Inspector" })).toBeVisible();

  await collapsePane(page, "Inspector");
  await expect(page.getByRole("button", { name: "Collapse Inspector" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand Inspector" })).toBeVisible();

  await expandPane(page, "Inspector");
  await expect(page.getByRole("button", { name: "Collapse Inspector" })).toBeVisible();
});

test("collapsing the inspector gives the cascade the width", async ({ page }) => {
  await boot(page);
  const width = async () => (await page.locator(".rl-cascade").boundingBox())?.width ?? 0;
  const before = await width();

  await collapsePane(page, "Inspector");
  await expect(page.locator(".rl-ledger-row").first()).toBeVisible();
  expect(await width()).toBeGreaterThan(before);

  await expandPane(page, "Inspector");
  await expect(page.getByRole("button", { name: "Collapse Inspector" })).toBeVisible();
});

test("both lenses stay usable with the inspector collapsed", async ({ page }) => {
  await boot(page);
  await collapsePane(page, "Inspector");

  await expect(page.locator(".rl-ledger-row").first()).toBeVisible();
  await selectCascadeLens(page, "Roll-up");
  await expect(page.locator(".rl-rollup-table tbody tr").first()).toBeVisible();
});

test("a collapsed inspector survives a reload", async ({ page }) => {
  await boot(page);
  await collapsePane(page, "Inspector");

  await page.reload();
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Inspector" })).toBeVisible();
  await expect(page.locator(".rl-ledger-row").first()).toBeVisible();
});
