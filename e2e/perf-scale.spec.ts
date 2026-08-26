import { test, expect } from "@playwright/test";

/**
 * Scale / viewport-bounded work. The cinema catalog refresh is the churn
 * that used to live on OpsBoard — keep the tree virtualized and the page
 * interactive while Query invalidates.
 */
test.describe("perf scale", () => {
  test("catalog refresh stays interactive", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("movies-screen")).toBeVisible({ timeout: 30_000 });
    const start = Date.now();
    await page.getByTestId("refresh-catalog").click();
    await expect(page.getByTestId("movies-screen")).toBeVisible();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
  });

  test("tree mounts few DOM rows even after catalog churn", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("refresh-catalog").click();
    const treeRows = page.locator(".rl-tree-row, [data-tree-row]");
    const count = await treeRows.count();
    expect(count).toBeLessThanOrEqual(120);
  });
});
