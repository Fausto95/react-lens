import { test, expect } from "@playwright/test";
import { boot, jumpTo } from "./helpers.js";

async function selectAsyncContent(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".rl-tree-search").fill("AsyncContent");
  const row = page
    .getByRole("treeitem")
    .filter({ has: page.locator(".rl-tree-name", { hasText: /^AsyncContent/ }) })
    .first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  await expect(page.locator(".rl-insp-head h2")).toHaveText(/^AsyncContent/);
}

test("SuspenseDemo suspends then resolves, with Suspense chip in the inspector", async ({
  page,
}) => {
  await boot(page);

  await selectAsyncContent(page);
  await expect(page.locator(".rl-chip", { hasText: /Suspense|suspended/ })).toBeVisible();

  await page.getByRole("button", { name: "Reload (suspend)" }).click();
  await expect(page.getByText("Loading…")).toBeVisible();

  await expect
    .poll(
      async () =>
        (await page.locator(".rl-chip.warn", { hasText: "suspended" }).count()) +
        (await page.locator(".rl-pip.suspended").count()) +
        (await page.locator('.rl-status-metric[title="Suspended"]').count()) +
        ((await page.getByText("Loading…").count()) > 0 ? 1 : 0),
      { timeout: 2_500 },
    )
    .toBeGreaterThan(0);

  await expect(page.getByText(/Resolved content \(load #1\)/)).toBeVisible({ timeout: 5_000 });
  await selectAsyncContent(page);
  await expect(page.locator(".rl-chip", { hasText: /Suspense|suspended/ })).toBeVisible();
});

test("TransitionDemo surfaces pending work in the inspector", async ({ page }) => {
  await boot(page);
  await jumpTo(page, "TransitionDemo");

  const input = page.getByPlaceholder("filter (transition)…");
  await input.fill("Item 12");

  await expect(page.locator(".rl-insp-head h2")).toHaveText("TransitionDemo");
  await expect(page.locator(".ihead", { hasText: "State" }).first()).toBeVisible();
  await expect(page.getByText("Item 12").first()).toBeVisible();
});
