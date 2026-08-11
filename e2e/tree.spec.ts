import { test, expect, type Page } from "@playwright/test";
import { boot } from "./helpers.js";

test("arrow keys walk the tree and the inspector follows", async ({ page }) => {
  await boot(page);
  const tree = page.locator(".rl-tree-scroll");
  await tree.focus();

  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("Toolbar");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("Ticker");

  // Left from a leaf jumps to the parent row.
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("Toolbar");
});

test("filter accepts regex, shows a match count, and flags invalid patterns", async ({ page }) => {
  await boot(page);
  const input = page.locator(".rl-tree-search");

  await input.fill("/^Tick/");
  await expect(page.locator(".rl-tree-search-count")).toHaveText("2");
  await expect(page.locator(".rl-tree-name", { hasText: "Ticker" }).first()).toBeVisible();

  await input.fill("/[bad/");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".rl-tree-search-count.invalid")).toHaveText("!");
  await expect(input).toHaveAttribute("title", /invalid regex/i);

  // Structured tokens still work and errors clear.
  await input.fill("renders:>=1 tick");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator(".rl-tree-search-count")).toHaveText("2");
});

test("command palette fuzzy-jumps to a component", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator(".rl-cmdk-input");
  await expect(palette).toBeFocused();
  await palette.fill("hshow"); // fuzzy: H…Showcase
  await expect(page.locator(".rl-cmdk-item.active")).toContainText("HooksShowcase");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rl-insp-head h2")).toHaveText("HooksShowcase");
});

/** Pick a component by name through the command palette (works past tree windowing). */
async function selectViaPalette(page: Page, name: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator(".rl-cmdk-input");
  await expect(palette).toBeFocused();
  await palette.fill(name);
  await expect(page.locator(".rl-cmdk-item.active")).toContainText(name);
  await page.keyboard.press("Enter");
  await expect(page.locator(".rl-insp-head h2")).toHaveText(name);
}

const highlightBox = (page: Page) => page.locator("#react-lens-highlight > div").first();

/** Viewport-relative top of the first highlight box, in CSS pixels. */
async function boxTop(page: Page): Promise<number> {
  return highlightBox(page).evaluate((el) => el.getBoundingClientRect().top);
}

/** Wait out the smooth reveal animation; returns the resting scroll offset. */
async function settledScrollY(page: Page): Promise<number> {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const y = await page.evaluate(() => window.scrollY);
      const stable = y === last;
      last = y;
      return stable;
    })
    .toBe(true);
  return last;
}

test("selecting a component walks the page to it and leaves visible ones alone", async ({
  page,
}) => {
  await boot(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Ticker sits in the Toolbar at the top of the page: already visible, so
  // selecting it must not move anything (tree ↑/↓ selects on every keystroke).
  await selectViaPalette(page, "Ticker");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // ExternalStoreDemo is the last section on the page — far below the fold.
  await selectViaPalette(page, "ExternalStoreDemo");
  expect(await settledScrollY(page)).toBeGreaterThan(200);
  // …and the highlight lands where the user can see it.
  const revealedTop = await boxTop(page);
  expect(revealedTop).toBeGreaterThanOrEqual(0);
  expect(revealedTop).toBeLessThan(page.viewportSize()!.height);
});

test("the highlight box follows the page as it scrolls", async ({ page }) => {
  await boot(page);
  await selectViaPalette(page, "ExternalStoreDemo");
  expect(await settledScrollY(page)).toBeGreaterThan(200);

  // Scroll back up — the revealed section is the last one, so down is a no-op.
  const before = await boxTop(page);
  await page.evaluate(() => window.scrollBy(0, -120));
  await expect.poll(() => boxTop(page)).toBeGreaterThan(before + 100);
});
