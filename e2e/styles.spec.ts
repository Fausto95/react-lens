import { test, expect, type Page } from "@playwright/test";
import { boot, cascadeToolbar, clickInPage, ensureTravelOn, goLive } from "./helpers.js";

/**
 * Do styles follow the playhead?
 *
 * The panel's claim is that anything derived from state rewinds — class names and
 * styles included. These specs assert the *computed* style, not text, because a
 * className that reverts while the paint does not is exactly the reported bug.
 *
 * Rows come in compiled / `"use no memo"` pairs (see StyleMatrix). A failure in
 * only the compiled half indicts the React Compiler's memo cache; a failure in
 * both is a restore problem.
 */

/** The state each row reports as text, and the colour it painted. */
async function readRow(page: Page, label: string): Promise<{ step: string; color: string }> {
  const step = await page.locator(`[data-style-row="${label}"]`).innerText();
  const color = await page
    .locator(`[data-style-swatch="${label}"]`)
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  return { step: step.trim(), color };
}

/** Advance a row's state n times, each click its own interaction. */
async function bump(page: Page, label: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await clickInPage(page, label);
    await page.waitForTimeout(350);
  }
}

const ROWS = ["class", "class-nomemo", "inline", "inline-nomemo", "emotion", "imperative"] as const;

/** Steps a row through its states and returns what each one paints. */
async function record(page: Page, label: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  for (let step = 0; step < 3; step++) {
    const row = await readRow(page, label);
    seen.set(row.step, row.color);
    if (step < 2) await bump(page, label, 1);
  }
  return seen;
}

for (const label of ROWS) {
  test(`${label}: the swatch follows the playhead`, async ({ page }) => {
    await boot(page);
    await ensureTravelOn(page);

    const start = await readRow(page, label);
    expect(start.step).toBe("0");

    await bump(page, label, 2);
    const live = await readRow(page, label);
    expect(live.step).toBe("2");
    expect(live.color).not.toBe(start.color);

    // Step back through interactions: whatever state the row reports, the paint
    // must agree with it. Colour is asserted against the state the page itself
    // claims, so this holds wherever the playhead lands.
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await cascadeToolbar(page).getByRole("button", { name: "Previous interaction" }).click();
      await page.waitForTimeout(250);
      const now = await readRow(page, label);
      seen.add(now.step);
      if (now.step === "0") {
        expect(now.color).toBe(start.color);
        break;
      }
    }
    expect(seen.has("0")).toBe(true);

    await goLive(page);
    await expect
      .poll(async () => (await readRow(page, label)).color, { timeout: 10_000 })
      .toBe(live.color);
  });
}

test("transition: the rewound colour lands without waiting out the ease", async ({ page }) => {
  await boot(page);
  await ensureTravelOn(page);

  // Record what each step paints once the live transition has settled, so the
  // rewind can be judged against the colour that step is supposed to show.
  const expected = new Map<string, string>();
  for (let step = 0; step < 3; step++) {
    await page.waitForTimeout(500); // outlast the 400ms ease
    const row = await readRow(page, "transition");
    expected.set(row.step, row.color);
    if (step < 2) await bump(page, "transition", 1);
  }
  expect(expected.size).toBe(3);

  await cascadeToolbar(page).getByRole("button", { name: "Previous interaction" }).click();
  // Read while the ease would still be running. The playhead has moved, so the
  // paint must already be at the rewound value — easing toward it is precisely
  // what reads as "styles didn't rewind".
  await page.waitForTimeout(100);
  const now = await readRow(page, "transition");
  expect(now.color, `step ${now.step} should already paint its own colour`).toBe(
    expected.get(now.step),
  );

  await goLive(page);
});

test("a CSS variable written outside React needs an adapter to rewind", async ({ page }) => {
  await boot(page);
  await ensureTravelOn(page);

  const globalHues = await record(page, "globalvar");
  const adapterHues = await record(page, "adaptervar");
  expect(globalHues.size).toBe(3);
  expect(adapterHues.size).toBe(3);

  const liveGlobal = await readRow(page, "globalvar");
  expect(liveGlobal.step).toBe("2");

  // Step back far enough that both stores held step 0.
  for (let i = 0; i < 10; i++) {
    await cascadeToolbar(page).getByRole("button", { name: "Previous interaction" }).click();
    await page.waitForTimeout(200);
    if ((await readRow(page, "adaptervar")).step === "0") break;
  }

  // The registered store follows the playhead, variable and all.
  const rewoundAdapter = await readRow(page, "adaptervar");
  expect(rewoundAdapter.step).toBe("0");
  expect(rewoundAdapter.color).toBe(adapterHues.get("0"));

  // The unregistered one does not, and that is the documented limit rather than a
  // bug: there is no hook to override and the variable is not React's to restore.
  const rewoundGlobal = await readRow(page, "globalvar");
  expect(rewoundGlobal.step).toBe("2");
  expect(rewoundGlobal.color).toBe(globalHues.get("2"));

  await goLive(page);
});
