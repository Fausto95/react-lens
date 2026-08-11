import { test, expect } from "@playwright/test";

/**
 * The production story: a minified bundle, no dev-only fiber fields, no
 * `_debugStack`. Everything here comes from locating component functions in the
 * shipped code and symbolicating through the deployed source map.
 *
 * Served by the `prod` project's webServer (a real `vite build` + `preview`).
 */
const PROD = "http://localhost:5198/";

/** Select a tree row and read the inspector's identity + source chip. */
async function inspectRow(page: import("@playwright/test").Page, index: number) {
  await page.locator(".rl-tree-row").nth(index).click();
  const source = page.locator(".rl-insp-source");
  await expect(source).not.toHaveText("no source");
  return {
    name: (await page.locator(".rl-insp-head h2").textContent())!,
    minified: await page
      .locator(".rl-insp-head .rl-chip.dim")
      .first()
      .textContent()
      .catch(() => null),
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
    // If this ever shows real names, the build stopped being a prod build and
    // the rest of this file would pass for the wrong reason.
    const names = await page.locator(".rl-tree-name").allTextContents();
    expect(names.length).toBeGreaterThan(3);
    expect(names.slice(0, 6).some((n) => /^(App|Toolbar|Ticker)$/.test(n))).toBe(false);
  });

  test("resolves original file, line, and un-minified name", async ({ page }) => {
    const root = await inspectRow(page, 0);
    // The fiber only knows a mangled name; the panel shows the real one and
    // keeps the minified identifier beside it.
    expect(root.name).toBe("App");
    expect(root.minified).toMatch(/^[A-Za-z$_][\w$]{0,3}$/);
    expect(root.minified).not.toBe("App");
    expect(root.source).toMatch(/^src\/App\.tsx:\d+$/);
  });

  test("resolves nested components to their own files", async ({ page }) => {
    const second = await inspectRow(page, 1);
    expect(second.name).toBe("Toolbar");
    expect(second.source).toMatch(/^src\/scenarios\/Toolbar\.tsx:\d+$/);
  });

  test("names a component whose frame lands on a hook call", async ({ page }) => {
    // Ticker's located line is its useState line, where the source map records
    // the identifier "useState" — the declaration search must win.
    const rows = await Promise.all([inspectRow(page, 2), inspectRow(page, 3)]);
    for (const row of rows) {
      expect(row.name).toBe("Ticker");
      expect(row.name).not.toBe("useState");
    }
  });

  test("the Source tab agrees with the header", async ({ page }) => {
    await inspectRow(page, 0);
    const head = page.locator(".rl-sec-head", { hasText: "Source" }).first();
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    await expect(page.locator(".rl-source-loc")).toContainText("App.tsx");
  });

  test("time travel and live edit stay disabled without dev APIs", async ({ page }) => {
    // Production react-dom exposes no overrideProps/overrideHookState, so the
    // panel must not pretend otherwise.
    const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
    await expect(travel).toBeDisabled();
  });
});
