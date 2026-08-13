import { test, expect } from "@playwright/test";
import { boot } from "./helpers.js";

/** Keep host controls in the strip above the bottom dock so pointer events land. */
async function pageControl(page: import("@playwright/test").Page, name: string) {
  const btn = page.getByRole("button", { name, exact: true }).first();
  await btn.evaluate((el: HTMLElement) => el.scrollIntoView({ block: "start", inline: "nearest" }));
  await page.waitForTimeout(50);
  return btn;
}

test("inspect mode highlights on hover and Escape un-lights the button", async ({ page }) => {
  await boot(page);
  const crosshair = page.getByRole("button", { name: "Inspect element on page" });

  await crosshair.click();
  await expect(crosshair).toHaveAttribute("aria-pressed", "true");

  const target = await pageControl(page, "count +1");
  await target.hover();
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
  const target = await pageControl(page, "count +1");
  await target.click();
  await expect(page.locator(".rl-insp-head h2")).toHaveText("HooksShowcase");
  await page.keyboard.press("Escape");
});
