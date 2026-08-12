import { test, expect, type Page } from "@playwright/test";

/**
 * Playing the session back must hand the cursor back to the present.
 *
 * A historical cursor keeps time travel applied to the page, and the
 * instrumentation drops every commit while it is — that is what keeps the
 * rewound UI out of the log. A finished play-once used to leave the cursor
 * historical, so travel stayed applied and renders were never captured again:
 * after a replay, nothing was traced.
 */

/** Statusbar render count (`rnd N`) — only real renders move it. */
async function renderCount(page: Page): Promise<number> {
  const text = await page.locator(".rl-statusbar").innerText();
  const n = Number(/rnd\s+(\d+)/i.exec(text.replace(/\s+/g, " "))?.[1]);
  if (!Number.isFinite(n)) throw new Error(`Could not parse render count from "${text}"`);
  return n;
}

/** The embedded panel docks over the demo, so hit-testing sees page buttons covered. */
async function clickInPage(page: Page, label: string): Promise<void> {
  await page
    .getByRole("button", { name: label })
    .first()
    .evaluate((el: HTMLElement) => el.click());
}

test("capture resumes after a play-once reaches the present", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rl-root")).toBeVisible();
  await expect(page.locator(".rl-tree-name", { hasText: /^Storefront$/ }).first()).toBeVisible();
  await clickInPage(page, "Refresh prices");
  await expect.poll(() => renderCount(page)).toBeGreaterThan(0);

  // Scrub into the past: time travel applies and the page stops reporting renders.
  const canvas = page.locator(".tl-canvas-root canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("timeline canvas has no box");
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);

  const scrubbed = await renderCount(page);
  await clickInPage(page, "Add");
  await page.waitForTimeout(500);
  expect(await renderCount(page)).toBe(scrubbed);

  // Play to the end: reaching the present must release travel.
  const play = page.getByRole("button", { name: "Play", exact: true });
  await play.click();
  await expect.poll(() => play.getAttribute("aria-pressed"), { timeout: 20_000 }).not.toBe("true");

  await clickInPage(page, "Refresh prices");
  await expect.poll(() => renderCount(page), { timeout: 15_000 }).toBeGreaterThan(scrubbed);
});
