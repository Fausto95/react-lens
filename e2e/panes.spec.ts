import { test, expect } from "@playwright/test";
import { boot, cascadeToolbar, collapsePane, expandPane } from "./helpers.js";

test("Components pane collapses to a rail and expands back", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".rl-tree-search")).toBeVisible();

  await collapsePane(page, "Components");
  await expect(page.locator(".rl-tree-search")).toHaveCount(0);
  await expect(page.locator(".rl-cascade-stage")).toBeVisible();

  await expandPane(page, "Components");
  await expect(page.locator(".rl-tree-search")).toBeVisible();
  await expect(page.locator(".rl-tree-name", { hasText: /^App$/ }).first()).toBeVisible();
});

test("Inspector pane collapses to a rail and expands back", async ({ page }) => {
  await boot(page);
  await expect(page.getByRole("button", { name: "Collapse Inspector" })).toBeVisible();

  await collapsePane(page, "Inspector");
  await expect(page.getByRole("button", { name: "Collapse Inspector" })).toHaveCount(0);

  await expandPane(page, "Inspector");
  await expect(page.getByRole("button", { name: "Collapse Inspector" })).toBeVisible();
});

test("collapsing both side panes keeps Cascade usable", async ({ page }) => {
  await boot(page);
  await collapsePane(page, "Components");
  await collapsePane(page, "Inspector");

  await expect(page.locator(".rl-cascade-stage")).toBeVisible();
  await cascadeToolbar(page).getByRole("button", { name: "Fit the entire cascade" }).click();
  await cascadeToolbar(page).getByRole("button", { name: "Reset zoom to 100%" }).click();
  await expect(page.locator(".rl-cascade-zoom")).toHaveText("100%");

  await expandPane(page, "Components");
  await expandPane(page, "Inspector");
  await expect(page.locator(".rl-tree-search")).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse Inspector" })).toBeVisible();
});

test("collapsed panes survive a reload", async ({ page }) => {
  await boot(page);
  await collapsePane(page, "Components");
  await collapsePane(page, "Inspector");

  await page.reload();
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Components" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Inspector" })).toBeVisible();
  await expect(page.locator(".rl-cascade-stage")).toBeVisible();
});
