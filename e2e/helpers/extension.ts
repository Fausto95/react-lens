/**
 * Shared helpers for the MV3 extension Playwright project.
 * Specs skip until `E2E_EXTENSION_PATH` points at a built unpacked dist.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_EXTENSION_DIST = path.resolve(here, "../../apps/extension/dist");

export function extensionPath(): string | null {
  const fromEnv = process.env.E2E_EXTENSION_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  return null;
}

/** True when the unpacked extension is available for Chromium --load-extension. */
export function extensionReady(): boolean {
  return Boolean(extensionPath() || process.env.E2E_EXTENSION_BUILT === "1");
}

export async function launchWithExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const dist = extensionPath() ?? DEFAULT_EXTENSION_DIST;
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  let extensionId = "";
  for (const page of context.pages()) {
    // Best-effort: SW target URL contains the id.
    void page;
  }
  // Chromium exposes the extension via service workers in modern Playwright.
  const workers = context.serviceWorkers();
  if (workers[0]) {
    const url = workers[0].url();
    extensionId = new URL(url).host;
  }
  if (!extensionId) {
    // Wait briefly for the SW to register.
    const sw = await context.waitForEvent("serviceworker", { timeout: 15_000 }).catch(() => null);
    if (sw) extensionId = new URL(sw.url()).host;
  }
  return { context, extensionId };
}

export async function openFixtureTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const base = process.env.E2E_PORT
    ? `http://localhost:${process.env.E2E_PORT}`
    : "http://localhost:5201";
  await page.goto(base);
  return page;
}
