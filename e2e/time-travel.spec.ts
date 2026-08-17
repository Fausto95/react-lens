import { test, expect } from "@playwright/test";
import {
  boot,
  bumpCounter,
  cascadeToolbar,
  cartLine,
  clickInPage,
  counterLine,
  ensureTravelOn,
  goLive,
  replayAllButton,
} from "./helpers.js";

async function watchCounter(page: import("@playwright/test").Page): Promise<void> {
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
}

function seenCounts(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
}

test("replay all walks the app through history and returns to the live count", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);
  await ensureTravelOn(page);
  await watchCounter(page);

  await replayAllButton(page).click();
  await expect
    .poll(
      async () => {
        const seen = await seenCounts(page);
        const joined = seen.join(" ");
        return /count 1/.test(joined) && /count 2/.test(joined) && /count 3/.test(joined);
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await expect
    .poll(async () => replayAllButton(page).getAttribute("aria-label"), { timeout: 10_000 })
    .toMatch(/^Replay all/);
  await expect(counterLine(page)).toContainText("count 3");
});

test("Stop during Replay all, then Go live, restores the live counter", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 3);
  await ensureTravelOn(page);

  await replayAllButton(page).click();
  await page.waitForTimeout(250);
  await replayAllButton(page).click();

  await goLive(page);
  await expect
    .poll(async () => counterLine(page).innerText(), { timeout: 10_000 })
    .toContain("count 3");
});

test("previous interaction rewinds the page; Latest returns to the live count", async ({
  page,
}) => {
  await boot(page);
  await bumpCounter(page, 2);
  await ensureTravelOn(page);

  let saw = false;
  for (let i = 0; i < 12; i++) {
    await cascadeToolbar(page).getByRole("button", { name: "Previous interaction" }).click();
    await page.waitForTimeout(80);
    if ((await counterLine(page).innerText()).includes("count 1")) {
      saw = true;
      break;
    }
  }
  expect(saw).toBe(true);

  await cascadeToolbar(page).getByRole("button", { name: "Follow the latest interaction" }).click();
  await expect
    .poll(async () => counterLine(page).innerText(), { timeout: 10_000 })
    .toContain("count 2");
});

test("the page registers its store through the __REACT_LENS__ page API", async ({ page }) => {
  await boot(page);
  // The surface an app reaches through @reactlens/adapters — and the one the
  // MAIN-world extension bridge installs. Its absence would mean the fixture
  // is rewinding through the embedded runtime object instead.
  const hasApi = await page.evaluate(() => {
    const api = (window as unknown as Record<string, unknown>).__REACT_LENS__ as
      | { registerStore?: unknown; markInteraction?: unknown }
      | undefined;
    return typeof api?.registerStore === "function" && typeof api?.markInteraction === "function";
  });
  expect(hasApi).toBe(true);
});

test("the restore pill counts rewound stores and names failures", async ({ page }) => {
  await boot(page);
  await ensureTravelOn(page);
  await clickInPage(page, "Add");
  await page.waitForTimeout(350);
  await clickInPage(page, "Add");
  await page.waitForTimeout(350);

  await cascadeToolbar(page).getByRole("button", { name: "Previous interaction" }).click();
  const pill = page.locator(".rl-tl-restore");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText(/\d+ store/);

  await goLive(page);
  await expect(pill).toHaveCount(0);
});

test("external store cart rewinds with the selected interaction", async ({ page }) => {
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
    await cascadeToolbar(page).getByRole("button", { name: "Previous interaction" }).click();
    await page.waitForTimeout(100);
    const text = await cartLine(page).innerText();
    seen.add(text);
    if (text.includes("cart: 0")) break;
  }
  expect([...seen].some((t) => /cart: 1/.test(t))).toBe(true);
  expect([...seen].some((t) => /cart: 0/.test(t))).toBe(true);

  await goLive(page);
  await expect
    .poll(async () => cartLine(page).innerText(), { timeout: 10_000 })
    .toContain("cart: 2");
});
