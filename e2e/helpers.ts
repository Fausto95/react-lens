import { expect, type Page } from "@playwright/test";

/** Load the playground and wait for the panel + first commit to settle. */
export async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".rl-root")).toBeVisible();
  // The Load interaction has landed once the tree shows the app root.
  await expect(page.locator(".rl-tree-name", { hasText: /^App$/ }).first()).toBeVisible();
}

/**
 * Click "count +1" n times, spaced past the interaction window so each click
 * lands as its own commit + interaction (replay walks them one by one).
 */
export async function bumpCounter(page: Page, n: number): Promise<void> {
  const btn = page.getByRole("button", { name: "count +1" });
  for (let i = 0; i < n; i++) {
    await btn.click();
    await page.waitForTimeout(350);
  }
  await expect(page.locator("text=/count \\d+ · doubled/")).toContainText(`count ${n}`);
}

/** The HooksShowcase counter line, e.g. "count 3 · doubled 6 · …". */
export function counterLine(page: Page) {
  return page.locator("text=/count \\d+ · doubled/");
}

/** Select a component in the tree by its displayed name prefix. */
export async function selectInTree(page: Page, namePrefix: string): Promise<void> {
  // Anchor on the name span: expandable rows prepend the caret glyph to
  // their accessible name, so role-name matching can't be ^-anchored.
  await page
    .getByRole("treeitem")
    .filter({ has: page.locator(".rl-tree-name", { hasText: new RegExp(`^${namePrefix}`) }) })
    .first()
    .click();
  await expect(page.locator(".rl-insp-head h2")).toHaveText(new RegExp(`^${namePrefix}`));
}

/** Open a collapsed inspector section by its title. */
export async function openSection(page: Page, title: string): Promise<void> {
  const head = page.locator(".rl-sec-head", { hasText: title }).first();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
}
