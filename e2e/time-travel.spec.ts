import { test, expect } from "@playwright/test";
import { boot, bumpCounter, counterLine } from "./helpers.js";

/**
 * The flagship journey: real time travel drives the INSPECTED APP's DOM.
 * Replay must walk the page through every commit's state and return live —
 * the exact regression of "time-travel changes don't reflect when I replay".
 */

test("replay walks the app through history and returns live", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);

  const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
  await expect(travel).toBeEnabled();
  if ((await travel.getAttribute("aria-pressed")) !== "true") await travel.click();

  // Record every distinct counter value the page shows during replay.
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

  await page.getByRole("button", { name: "Play from playhead" }).click();

  // The page must pass through the intermediate states, not sit on the end.
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen),
      { timeout: 15_000 },
    )
    .toEqual(["count 3", "count 0", "count 1", "count 2", "count 3"]);

  await expect(page.locator(".rl-tl-live-label")).toHaveText("LIVE");
  await expect(counterLine(page)).toContainText("count 3");
});

test("stepping to the previous interaction rewinds the page; L returns live", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);

  await page.getByRole("button", { name: "Previous interaction ([)" }).click();
  await expect(counterLine(page)).toContainText("count 1");
  await expect(page.locator(".rl-tl-live-label")).toContainText("PAST");

  await page.keyboard.press("l");
  await expect(page.locator(".rl-tl-live-label")).toHaveText("LIVE");
  await expect(counterLine(page)).toContainText("count 2");
});
