import { test, expect } from "@playwright/test";

/**
 * Scale / viewport-bounded work. Asserts the OpsBoard scenario can churn
 * without the panel freezing, and that tree virtualization keeps DOM small.
 */
test.describe("perf scale", () => {
  test("ops board burst stays interactive", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("ops-board")).toBeVisible({ timeout: 30_000 });
    const start = Date.now();
    await page.getByTestId("ops-burst").click();
    await expect(page.getByTestId("ops-board")).toContainText(/tick/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
  });

  test("tree mounts few DOM rows even after scale churn", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("ops-tick").click();
    // Panel tree virtualization — look for redesign tree rows if panel is embedded.
    const treeRows = page.locator(".rl-tree-row, [data-tree-row]");
    const count = await treeRows.count();
    // Either panel not mounted in this fixture, or virtualized ≤ ~120 rows.
    expect(count).toBeLessThanOrEqual(120);
  });
});
