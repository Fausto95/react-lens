import { test, expect } from "@playwright/test";
import {
  boot,
  bumpCounter,
  counterLine,
  cartLine,
  ensureTravelOn,
  clickInPage,
} from "./helpers.js";

const tl = (page: import("@playwright/test").Page) => page.locator(".tl-toolbar");

test("replay walks the app through history and returns live", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);
  await ensureTravelOn(page);

  await page.evaluate(() => {
    const w = window as unknown as { __seen: string[] };
    w.__seen = [];
    const push = () => {
      const txt = document.body.innerText.match(/count \d+/)?.[0];
      if (txt && w.__seen.at(-1) !== txt) w.__seen.push(txt);
    };
    push();
    new MutationObserver(push).observe(document.body, {
      subtree: true,
      characterData: true,
      childList: true,
    });
  });

  await tl(page).getByRole("button", { name: "Play in reverse" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen.length), {
      timeout: 15_000,
    })
    .toBeGreaterThan(1);

  // Return to live via End (go-live), not L — reverse play can leave the
  // transport mid-history where L only changes speed.
  await page.keyboard.press("End");

  await expect
    .poll(async () => counterLine(page).innerText(), { timeout: 10_000 })
    .toContain("count 3");
});

test("stepping to the previous commit rewinds the page; L returns live", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);
  await ensureTravelOn(page);

  // Walk back until the page shows count 1 (commits may outnumber interactions).
  let saw = false;
  for (let i = 0; i < 12; i++) {
    await tl(page).getByRole("button", { name: "Previous commit" }).click();
    await page.waitForTimeout(80);
    if ((await counterLine(page).innerText()).includes("count 1")) {
      saw = true;
      break;
    }
  }
  expect(saw).toBe(true);
  await expect(tl(page).getByRole("button", { name: "Live" })).toBeVisible();

  await page.keyboard.press("l");
  await expect(tl(page).getByRole("button", { name: "Live" })).toHaveCount(0);
  await expect(counterLine(page)).toContainText("count 2");
});

test("external store cart rewinds with the playhead", async ({ page }) => {
  await boot(page);
  await ensureTravelOn(page);

  await expect(cartLine(page)).toContainText("cart: 0");
  await clickInPage(page, "Add");
  await page.waitForTimeout(350);
  await clickInPage(page, "Add");
  await page.waitForTimeout(350);
  await expect(cartLine(page)).toContainText("cart: 2");

  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    await tl(page).getByRole("button", { name: "Previous commit" }).click();
    await page.waitForTimeout(100);
    const text = await cartLine(page).innerText();
    seen.add(text);
    if (text.includes("cart: 0")) break;
  }
  expect([...seen].some((t) => /cart: 1/.test(t))).toBe(true);
  expect([...seen].some((t) => /cart: 0/.test(t))).toBe(true);

  await page.keyboard.press("l");
  await expect(tl(page).getByRole("button", { name: "Live" })).toHaveCount(0);
  await expect(cartLine(page)).toContainText("cart: 2");
});
