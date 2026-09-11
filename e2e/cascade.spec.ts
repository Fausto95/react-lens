import { test, expect } from "@playwright/test";
import {
  boot,
  bumpCounter,
  cascade,
  cascadeToolbar,
  clickInPage,
  collapsePane,
  eventCount,
  expandPane,
  interactionRows,
  replayAllButton,
  replayButton,
  selectCascadeLens,
  waitForInteractions,
} from "./helpers.js";

test("cascade chrome: interaction stepping, lens switch, and latest", async ({ page }) => {
  await boot(page);
  const bar = cascadeToolbar(page);

  await expect(bar.getByRole("button", { name: "Previous interaction" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Next interaction" })).toBeVisible();
  for (const lens of ["Ledger", "Roll-up"]) {
    await expect(bar.getByRole("button", { name: lens, exact: true })).toBeVisible();
  }
  await expect(bar.getByRole("button", { name: "Follow the latest interaction" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(cascade(page).locator(".rl-cascade-footer")).toContainText(/renders/);
});

test("toolbar stays inside the cascade column when the panel is narrow", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await boot(page);
  const overflow = await page.evaluate(() => {
    const bar = document.querySelector(".rl-cascade-toolbar");
    const root = document.querySelector(".rl-cascade");
    if (!(bar instanceof HTMLElement) || !(root instanceof HTMLElement)) return true;
    const barBox = bar.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    return bar.scrollWidth > bar.clientWidth + 1 || barBox.right > rootBox.right + 1;
  });
  expect(overflow).toBe(false);
  // The lens switch survives narrowing — it is how you leave a lens.
  await expect(
    cascadeToolbar(page).getByRole("button", { name: "Ledger", exact: true }),
  ).toBeVisible();
  await expect(
    cascadeToolbar(page).getByRole("button", { name: "Follow the latest interaction" }),
  ).toBeVisible();
});

test("interaction rail records clicks and previous/next move the selection", async ({ page }) => {
  await boot(page);
  await waitForInteractions(page, 1);
  const before = await interactionRows(page).count();

  await bumpCounter(page, 2);
  await expect.poll(async () => interactionRows(page).count()).toBeGreaterThan(before);

  const latest = interactionRows(page).last();
  await expect(latest).toHaveClass(/selected/);

  await cascadeToolbar(page).getByRole("button", { name: "Previous interaction" }).click();
  await expect(latest).not.toHaveClass(/selected/);
  await expect(
    cascadeToolbar(page).getByRole("button", { name: "Follow the latest interaction" }),
  ).toHaveAttribute("aria-pressed", "false");

  await cascadeToolbar(page).getByRole("button", { name: "Next interaction" }).click();
  await expect(latest).toHaveClass(/selected/);
  await expect(
    cascadeToolbar(page).getByRole("button", { name: "Follow the latest interaction" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("clicking an interaction row selects it and unfollows latest", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);
  await waitForInteractions(page, 3);

  const first = interactionRows(page).first();
  const last = interactionRows(page).last();
  await expect(last).toHaveClass(/selected/);

  await first.click();
  await expect(first).toHaveClass(/selected/);
  await expect(last).not.toHaveClass(/selected/);
  await expect(
    cascadeToolbar(page).getByRole("button", { name: "Follow the latest interaction" }),
  ).toHaveAttribute("aria-pressed", "false");

  await cascadeToolbar(page).getByRole("button", { name: "Follow the latest interaction" }).click();
  await expect(last).toHaveClass(/selected/);
});

test("replay controls are available while capture stays live", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 1);

  await expect(replayButton(page)).toBeEnabled();
  await expect(replayAllButton(page)).toBeEnabled();

  const mounted = await eventCount(page);
  await clickInPage(page, "Refresh prices");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(mounted);
});

test("every lens survives the inspector collapsing", async ({ page }) => {
  await boot(page);
  await collapsePane(page, "Inspector");

  await expect(page.locator(".rl-ledger-row").first()).toBeVisible();
  await selectCascadeLens(page, "Roll-up");
  await expect(page.locator(".rl-rollup-table tbody tr").first()).toBeVisible();

  await expandPane(page, "Inspector");
  await expect(page.locator(".rl-rollup-table tbody tr").first()).toBeVisible();
});

/* ------------------------------------------------------------------ lenses */

test("cascade opens on the ledger and the lens switch reaches the roll-up", async ({ page }) => {
  await boot(page);
  const bar = cascadeToolbar(page);

  await expect(bar.getByRole("button", { name: "Ledger", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".rl-ledger-row").first()).toBeVisible();

  await selectCascadeLens(page, "Roll-up");
  await expect(page.locator(".rl-rollup-table tbody tr").first()).toBeVisible();
  await expect(page.locator(".rl-rollup-table thead th").first()).toContainText("Component");
  await expect(page.locator(".rl-ledger-row")).toHaveCount(0);

  await selectCascadeLens(page, "Ledger");
  await expect(page.locator(".rl-ledger-row").first()).toBeVisible();
});

test("ledger filters by component and keeps the ancestors of a hit", async ({ page }) => {
  await boot(page);
  const rowsBefore = await page.locator(".rl-ledger-row").count();
  expect(rowsBefore).toBeGreaterThan(1);

  const name = await page.locator(".rl-ledger-row .rl-ledger-label").last().innerText();
  // The component tree has a filter too — scope to the cascade's own.
  await cascade(page).getByRole("textbox", { name: "Filter components" }).fill(name);

  await expect(page.locator(".rl-ledger-row")).not.toHaveCount(rowsBefore);
  // The hit itself is never dimmed; anything kept only as an ancestor is.
  await expect(page.locator(".rl-ledger-row:not([data-muted])").first()).toBeVisible();
});

test("a roll-up row drills into that component in the ledger", async ({ page }) => {
  await boot(page);
  await selectCascadeLens(page, "Roll-up");

  const row = page.locator(".rl-rollup-table tbody tr").first();
  const name = (await row.locator(".rl-rollup-name").innerText()).trim();
  await row.click();

  await selectCascadeLens(page, "Ledger");
  await expect(page.locator(".rl-ledger-row[data-selected] .rl-ledger-label").first()).toHaveText(
    name,
  );
});

test("a lens row hands its component to the AI panel", async ({ page }) => {
  await boot(page);

  const row = page.locator(".rl-ledger-row").first();
  const name = (await row.locator(".rl-ledger-label").first().innerText()).trim();
  await row.hover();
  await row.locator(".rl-row-ai").click();

  // The panel opens on its own and the component arrives as a chip.
  const chip = page.locator(".rl-agent-chip", { hasText: name });
  await expect(chip).toBeVisible();
  // Adding is not selecting — the row click must not have gone through.
  await expect(page.locator(".rl-ledger-row[data-selected]")).toHaveCount(0);

  // Adding the same component twice is a no-op.
  await row.locator(".rl-row-ai").click();
  await expect(page.locator(".rl-agent-chip", { hasText: name })).toHaveCount(1);

  await chip.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(page.locator(".rl-agent-chip", { hasText: name })).toHaveCount(0);
});

test("the roll-up offers the same hand-off", async ({ page }) => {
  await boot(page);
  await selectCascadeLens(page, "Roll-up");

  const row = page.locator(".rl-rollup-table tbody tr").first();
  const name = (await row.locator(".rl-rollup-name").innerText()).trim();
  await row.hover();
  await row.locator(".rl-row-ai").click();

  await expect(page.locator(".rl-agent-chip", { hasText: name })).toBeVisible();
  await expect(page.locator(".rl-rollup-table tbody tr[data-selected]")).toHaveCount(0);
});
