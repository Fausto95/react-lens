import { test, expect } from "@playwright/test";
import { boot, bumpCounter } from "./helpers.js";

const tl = (page: import("@playwright/test").Page) => page.locator(".tl-toolbar");

test("zoom buttons and Fit are available", async ({ page }) => {
  await boot(page);
  await expect(tl(page).getByRole("button", { name: "+", exact: true })).toBeVisible();
  await expect(tl(page).getByRole("button", { name: "−", exact: true })).toBeVisible();
  await tl(page).getByRole("button", { name: "Fit" }).click();
  await expect(tl(page)).toBeVisible();
});

test("play and previous-commit transport controls work", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 1);

  await tl(page).getByRole("button", { name: "Previous commit" }).click();
  await expect(tl(page).getByRole("button", { name: "Live" })).toBeVisible();

  await tl(page).getByRole("button", { name: "Live" }).click();
  await expect(tl(page).getByRole("button", { name: "Live" })).toHaveCount(0);
});

test("footer metrics show recording is on", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".rl-status-rec")).toContainText("rec");
});
