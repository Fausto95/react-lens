import { test, expect } from "@playwright/test";
import {
  boot,
  bumpCounter,
  cascade,
  cascadeToolbar,
  cascadeZoomPercent,
  clickInPage,
  collapsePane,
  eventCount,
  expandPane,
  hoverCascadeNode,
  interactionRows,
  replayAllButton,
  replayButton,
  waitForInteractions,
} from "./helpers.js";

test("cascade chrome: fit, 1:1, focus modes, and latest", async ({ page }) => {
  await boot(page);
  const bar = cascadeToolbar(page);

  await expect(bar.getByRole("button", { name: "Fit the entire cascade" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Reset zoom to 100%" })).toBeVisible();

  await bar.getByRole("button", { name: "Fit the entire cascade" }).click();
  await bar.getByRole("button", { name: "Reset zoom to 100%" }).click();
  expect(await cascadeZoomPercent(page)).toBe(100);

  const all = bar.getByRole("button", { name: "All renders" });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  const expensive = bar.getByRole("button", { name: "Expensive renders" });
  if ((await expensive.count()) > 0 && (await expensive.isVisible())) {
    await expensive.click();
    await expect(expensive).toHaveAttribute("aria-pressed", "true");
    await all.click();
    await expect(all).toHaveAttribute("aria-pressed", "true");
  }

  await expect(bar.getByRole("button", { name: "Follow the latest interaction" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".rl-cascade-stage")).toHaveAttribute(
    "aria-label",
    "Render cascade graph",
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
  await expect(
    cascadeToolbar(page).getByRole("button", { name: "Fit the entire cascade" }),
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

test("replay controls are available and recording stays on", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 1);

  await expect(replayButton(page)).toBeEnabled();
  await expect(replayAllButton(page)).toBeEnabled();
  await expect(page.locator(".rl-status-rec")).toContainText("rec");

  const mounted = await eventCount(page);
  await clickInPage(page, "Refresh prices");
  await expect.poll(() => eventCount(page)).toBeGreaterThan(mounted);
});

test("load cascade aggregates fan-out and Fit/1:1 change the zoom", async ({ page }) => {
  await boot(page);
  await expect(cascade(page).locator(".rl-cascade-footer")).toContainText(/\d[\d,]* renders/);
  await expect(cascade(page).locator(".rl-cascade-footer")).toContainText(/aggregated/i);
  await expect(page.locator(".rl-cascade-minimap")).toBeVisible();

  await cascadeToolbar(page).getByRole("button", { name: "Reset zoom to 100%" }).click();
  expect(await cascadeZoomPercent(page)).toBe(100);

  const stage = page.locator(".rl-cascade-stage");
  await stage.hover();
  await stage.evaluate((el) => {
    el.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
  const zoomed = await cascadeZoomPercent(page);
  expect(zoomed).toBeGreaterThan(100);

  await stage.focus();
  await page.keyboard.press("f");
  expect(await cascadeZoomPercent(page)).toBeLessThan(zoomed);

  await cascadeToolbar(page).getByRole("button", { name: "Reset zoom to 100%" }).click();
  expect(await cascadeZoomPercent(page)).toBe(100);
});

test("hovering and clicking a cascade node selects it in the inspector", async ({ page }) => {
  await boot(page);
  await collapsePane(page, "Components");
  await collapsePane(page, "Inspector");

  const hit = await hoverCascadeNode(page);
  const tip = page.locator(".rl-cascade-tooltip");
  await expect(tip).toBeVisible();
  const name = (await tip.locator("strong").textContent())?.trim() ?? "";
  expect(name.length).toBeGreaterThan(0);
  const meta = (await tip.locator("span").textContent()) ?? "";
  const aggregate = /\d+\s+renders/.test(meta);

  const stage = page.locator(".rl-cascade-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("cascade stage has no box");
  await page.mouse.click(box.x + hit.x, box.y + hit.y);

  await expect(page.getByRole("button", { name: "Focus cause" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Focus effects" })).toBeEnabled();

  if (aggregate) {
    const collapse = page.getByRole("button", { name: /Collapse all expanded render groups/ });
    await expect(collapse).toBeVisible();
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  } else {
    await expandPane(page, "Inspector");
    await expect(page.locator(".rl-insp-head h2")).toHaveText(
      new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  }
});

test("focus modes All / Roots are mutually exclusive", async ({ page }) => {
  await boot(page);
  await collapsePane(page, "Inspector");
  await collapsePane(page, "Components");

  const bar = cascadeToolbar(page);
  const all = bar.getByRole("button", { name: "All renders" });
  const roots = bar.getByRole("button", { name: "Interaction roots" });
  await expect(roots).toBeVisible();

  await roots.click();
  await expect(roots).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");

  await all.click();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(roots).toHaveAttribute("aria-pressed", "false");
});
