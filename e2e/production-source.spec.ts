import { test, expect } from "@playwright/test";

/**
 * Production story: minified bundle, sourcemaps restore names in the panel.
 * Served from the preview webServer on E2E_PROD_PORT (default 5202).
 *
 * Components set `displayName`, so the tree still shows App/HooksShowcase —
 * the prod guard is the shipped JS, not the tree labels.
 */
const PROD = `http://localhost:${process.env.E2E_PROD_PORT ?? 5202}/`;

async function inspectRow(page: import("@playwright/test").Page, index: number) {
  await page.locator(".rl-tree-row").nth(index).click();
  const source = page.locator(".rl-insp-source");
  await expect(source).not.toHaveText("no source");
  return {
    name: (await page.locator(".rl-insp-head h2").textContent())!,
    source: (await source.textContent())!,
  };
}

test.describe("production build", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROD);
    await expect(page.locator(".rl-root")).toBeVisible();
    await expect(page.locator(".rl-tree-row").first()).toBeVisible();
  });

  test("the bundle really is minified (guards the fixture)", async ({ page }) => {
    const src = await page.locator('script[type="module"]').first().getAttribute("src");
    expect(src).toBeTruthy();
    const js = await page.request.get(new URL(src!, PROD).href);
    const body = await js.text();
    // Prod chunk: short identifiers and no pretty-printed multi-line functions.
    expect(body.length).toBeGreaterThan(10_000);
    expect(body.includes("\n  function ")).toBe(false);
  });

  test("resolves original file and line via sourcemaps", async ({ page }) => {
    const root = await inspectRow(page, 0);
    expect(root.name).toMatch(/App/);
    expect(root.source).toMatch(/App\.tsx:\d+/);
  });

  test("Source tab agrees with the header", async ({ page }) => {
    await inspectRow(page, 0);
    const redesign = page.locator(".ihead", { hasText: "Source" }).first();
    if ((await redesign.count()) > 0) {
      await redesign.scrollIntoViewIfNeeded();
    } else {
      const head = page.locator(".rl-sec-head", { hasText: "Source" }).first();
      if ((await head.count()) > 0 && (await head.getAttribute("aria-expanded")) !== "true") {
        await head.click();
      }
    }
    await expect(page.locator(".rl-source-loc")).toContainText("App.tsx");
  });

  test("time travel is disabled AND explains itself", async ({ page }) => {
    const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
    await expect(travel).toBeDisabled();
    await expect(travel).toHaveAttribute("title", /development React build|production/i);
  });
});
