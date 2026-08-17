import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import {
  boot,
  bumpCounter,
  clickInPage,
  counterLine,
  ensureTravelOn,
  FIXTURES_DIR,
  saveDownload,
} from "./helpers.js";

test("export → import round-trip disables travel until a live click", async ({ page }) => {
  await boot(page);
  await bumpCounter(page, 2);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export session" }).click(),
  ]);
  const tmp = await saveDownload(download, `_tmp-export-${Date.now()}.json`);

  try {
    await page.getByRole("button", { name: "Import session" }).click();
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(tmp);

    const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
    await expect(travel).toBeDisabled();
    await expect(travel).toHaveAttribute("title", /Imported session/i);

    await clickInPage(page, "count +1");
    await page.waitForTimeout(350);

    await expect(travel).toBeEnabled();
    await ensureTravelOn(page);
    await expect(counterLine(page)).toBeVisible();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test("imports a committed protocol-v1 .lens.json fixture", async ({ page }) => {
  await boot(page);

  const fixture = path.join(FIXTURES_DIR, "minimal.lens.json");
  await page.getByRole("button", { name: "Import session" }).click();
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(fixture);

  const travel = page.getByRole("button", { name: "Apply state to the page while scrubbing" });
  await expect(travel).toBeDisabled();
  await expect(travel).toHaveAttribute("title", /Imported session/i);
});
