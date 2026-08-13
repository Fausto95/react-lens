import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

test("inspect mode highlights on hover and Escape un-lights the button", async ({ page }) => {
  await boot(page);
  const crosshair = page.getByRole("button", { name: "Inspect element on page" });

  await crosshair.click();
  await expect(crosshair).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "count +1" }).hover();
  const tip = page.locator("#react-lens-inspect-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("×");

  await page.keyboard.press("Escape");
  await expect(crosshair).toHaveAttribute("aria-pressed", "false");
  await expect(tip).toBeHidden();

  await crosshair.click();
  await expect(crosshair).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
});

test("clicking picks the component into the inspector", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Inspect element on page" }).click();
  await page.getByRole("button", { name: "count +1" }).click();
  await expect(page.locator(".rl-insp-head h2")).toHaveText("HooksShowcase");
  await page.keyboard.press("Escape");
});
