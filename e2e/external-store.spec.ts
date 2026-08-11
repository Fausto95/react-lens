import { test, expect } from "@playwright/test";
import { boot, cartLine, ensureTravelOn } from "./helpers.js";

/**
 * ExternalStoreDemo is the playground's reference for the opt-in store
 * adapter: mutate the cart, scrub back, assert the UI rewinds; go-live restores.
 */

test("external store cart rewinds with the playhead and restores on go-live", async ({
  page,
}) => {
  await boot(page);
  await ensureTravelOn(page);

  await expect(cartLine(page)).toContainText("cart: 0 items · $0");
  await page.getByRole("button", { name: "add Sticker" }).click();
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "add Mug" }).click();
  await page.waitForTimeout(350);
  await expect(cartLine(page)).toContainText("cart: 2 items · $17");

  // Step back through history — ticker/other interactions may sit between
  // the two adds, so walk until the empty cart snapshot appears.
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.getByRole("button", { name: "Previous interaction ([)" }).click();
    await page.waitForTimeout(100);
    const text = await cartLine(page).innerText();
    seen.add(text);
    if (text.includes("cart: 0 items")) break;
  }
  expect([...seen].some((t) => /cart: 1 items/.test(t))).toBe(true);
  expect([...seen].some((t) => /cart: 0 items/.test(t))).toBe(true);
  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");

  await page.keyboard.press("l");
  await expect(page.locator(".rl-tl-live-label")).toHaveText("LIVE");
  await expect(cartLine(page)).toContainText("cart: 2 items · $17");
});
