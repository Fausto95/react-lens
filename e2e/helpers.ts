import { expect, type Page, type Download } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(here, "fixtures");

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

/** Ensure travel is on (default) — no-op when already pressed / unsupported. */
export async function ensureTravelOn(page: Page): Promise<void> {
  const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
  await expect(travel).toBeEnabled();
  if ((await travel.getAttribute("aria-pressed")) !== "true") await travel.click();
}

/** Statusbar event count (the `ev N` metric). */
export async function eventCount(page: Page): Promise<number> {
  const text = await page
    .locator(".rl-statusbar")
    .locator(".rl-status-metric", { hasText: /ev/i })
    .innerText();
  const n = Number(/ev\s+(\d+)/i.exec(text.replace(/\s+/g, " "))?.[1]);
  if (!Number.isFinite(n)) throw new Error(`Could not parse event count from "${text}"`);
  return n;
}

/** Jump to a component via the command palette (works past tree virtualization). */
export async function jumpTo(page: Page, query: string, expectName?: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.locator(".rl-cmdk-input");
  await expect(input).toBeFocused();
  await input.fill(query);
  await page.keyboard.press("Enter");
  await expect(page.locator(".rl-insp-head h2")).toHaveText(new RegExp(`^${expectName ?? query}`));
}

/** PropsShowcase page line that mirrors the live prop values. */
export function propsLine(page: Page) {
  return page.locator("text=/text=.+, count=/");
}

/** External-store cart readout. */
export function cartLine(page: Page) {
  return page.locator("output", { hasText: /cart:/ });
}

/** Save an exported session download to disk and return its path. */
export async function saveDownload(download: Download, name: string): Promise<string> {
  const dest = path.join(FIXTURES_DIR, name);
  await download.saveAs(dest);
  return dest;
}

/** Seed BYOK OpenAI settings so the agent drawer can call the (mocked) API. */
export async function seedAgentKey(page: Page, apiKey = "sk-e2e-test"): Promise<void> {
  await page.evaluate(
    ({ key }) => {
      localStorage.setItem(
        "react-lens/agent-settings",
        JSON.stringify({
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: key,
          model: "gpt-4o-mini",
        }),
      );
    },
    { key: apiKey },
  );
}

/** Dispatch a keyboard event with explicit key/code/alt (AZERTY regressions). */
export async function dispatchKey(
  page: Page,
  init: { key: string; code: string; altKey?: boolean },
): Promise<void> {
  await page.evaluate((opts) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: opts.key,
        code: opts.code,
        altKey: !!opts.altKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, init);
}

/** Build a canned OpenAI SSE body from delta objects. */
export function openaiSse(deltas: unknown[]): string {
  const lines = deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`);
  lines.push("data: [DONE]\n\n");
  return lines.join("");
}
