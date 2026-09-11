import { expect, type Page, type Download } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(here, "..", "fixtures");

/** Load the fixture app and wait for the panel + first commit to settle. */
export async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".rl-root")).toBeVisible();
  // The mount interaction always produces a cascade, so the ledger's first row
  // is the signal that the panel is up and has data.
  await expect(page.locator(".rl-ledger-row").first()).toBeVisible();
}

/**
 * Click "count +1" n times, spaced past the interaction window so each click
 * lands as its own commit + interaction.
 */
export async function bumpCounter(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await clickInPage(page, "count +1");
    await page.waitForTimeout(350);
  }
  await expect(page.locator("text=/count \\d+ · doubled/")).toContainText(`count ${n}`);
}

/** The HooksShowcase counter line, e.g. "count 3 · doubled 6 · …". */
export function counterLine(page: Page) {
  return page.locator("text=/count \\d+ · doubled/");
}

/** Select a component in the tree by its displayed name prefix. */
/**
 * Select a component by clicking its row in the ledger. Reaches anything in the
 * current cascade, including components ⌘K cannot see because they unmounted.
 */
export async function selectInLedger(page: Page, namePrefix: string): Promise<void> {
  const row = page
    .locator(".rl-ledger-row")
    .filter({ has: page.locator(".rl-ledger-label", { hasText: new RegExp(`^${namePrefix}`) }) })
    .first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  await expect(page.locator(".rl-insp-head h2")).toHaveText(new RegExp(`^${namePrefix}`));
}

/**
 * Select a component by name. The Components pane is gone, so ⌘K is the way in
 * — and unlike the old tree it also reaches components that never rendered.
 */
export async function selectComponent(page: Page, namePrefix: string): Promise<void> {
  // The button, not ⌘K: the host page may claim that shortcut for itself.
  await page.getByRole("button", { name: "Command palette (⌘K)" }).click();
  const input = page.locator(".rl-cmdk-input");
  await expect(input).toBeVisible();
  await input.fill(namePrefix);
  await page
    .locator(".rl-cmdk-item")
    .filter({ has: page.locator(".rl-cmdk-kind.component") })
    .filter({ has: page.locator(".rl-cmdk-label", { hasText: new RegExp(`^${namePrefix}`) }) })
    .first()
    .click();
  await expect(page.locator(".rl-insp-head h2")).toHaveText(new RegExp(`^${namePrefix}`));
}

/** Reveal an inspector section by its title (redesign is always-expanded). */
export async function openSection(page: Page, title: string): Promise<void> {
  const redesign = page.locator(".ihead", { hasText: title }).first();
  if ((await redesign.count()) > 0) {
    await redesign.scrollIntoViewIfNeeded();
    return;
  }
  const head = page.locator(".rl-sec-head", { hasText: title }).first();
  if ((await head.count()) === 0) return;
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
  // Scope to the fixture page — the inspector DOM tab can mirror the same text.
  return page.locator("main").locator("text=/text=.+, count=/");
}

/** External-store cart readout. */
export function cartLine(page: Page) {
  return page.locator("output", { hasText: /cart:/ });
}

/**
 * Click a page button via the element — the embedded panel may cover hit-testing.
 */
export async function clickInPage(page: Page, label: string | RegExp): Promise<void> {
  const btn =
    typeof label === "string"
      ? page.getByRole("button", { name: label, exact: true }).first()
      : page.getByRole("button", { name: label }).first();
  await btn.evaluate((el: HTMLElement) => el.click());
}

/** Seed BYOK OpenAI settings so the agent drawer can call the (mocked) API. */
export async function seedAgentKey(page: Page, apiKey = "sk-e2e-test"): Promise<void> {
  await page.evaluate(
    ({ key }) => {
      // Legacy plaintext shape — the panel migrates it into the encrypted vault on load.
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

/** Save an exported session download to disk and return its path. */
export async function saveDownload(download: Download, name: string): Promise<string> {
  const dest = path.join(FIXTURES_DIR, name);
  await download.saveAs(dest);
  return dest;
}

export function cascade(page: Page) {
  return page.locator(".rl-cascade");
}

export function cascadeToolbar(page: Page) {
  return page.locator(".rl-cascade-toolbar");
}

/** Cascade opens on the Ledger lens; every other lens has to be asked for. */
export async function selectCascadeLens(page: Page, lens: "Ledger" | "Roll-up"): Promise<void> {
  await cascadeToolbar(page).getByRole("button", { name: lens, exact: true }).click();
}

/** Interaction replay (not Replay all). */
export function replayButton(page: Page) {
  return page.locator(".rl-cascade-transport-button:not(.session)");
}

/** Whole-session replay. */
export function replayAllButton(page: Page) {
  return page.locator(".rl-cascade-transport-button.session");
}

export function interactionRows(page: Page) {
  return page.locator(".rl-cascade-interaction");
}

export async function waitForInteractions(page: Page, min = 1): Promise<void> {
  await expect.poll(async () => interactionRows(page).count()).toBeGreaterThanOrEqual(min);
}

/** Return to live capture via the command palette. */
export async function goLive(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.locator(".rl-cmdk-input");
  await expect(input).toBeFocused();
  await input.fill("Go live");
  await page.keyboard.press("Enter");
}

export type PanelPane = "Inspector";

export async function collapsePane(page: Page, pane: PanelPane): Promise<void> {
  await page.getByRole("button", { name: `Collapse ${pane}` }).click();
  await expect(page.getByRole("button", { name: `Expand ${pane}` })).toBeVisible();
}

export async function expandPane(page: Page, pane: PanelPane): Promise<void> {
  await page.getByRole("button", { name: `Expand ${pane}` }).click();
  await expect(page.getByRole("button", { name: `Collapse ${pane}` })).toBeVisible();
}
