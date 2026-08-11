/**
 * Regenerate apps/site/public/og.png from scripts/og.html.
 *
 * The card is a static local page screenshotted at exactly the geometry the
 * meta tags declare (og:image:width/height = 1200x630), so the source of the
 * social preview lives in the repo instead of only as a committed binary.
 *
 * Usage: pnpm og:site  (or, from apps/site, pnpm og)
 */
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const WIDTH = 1200;
const HEIGHT = 630;

const source = fileURLToPath(new URL("./og.html", import.meta.url));
const out = fileURLToPath(new URL("../public/og.png", import.meta.url));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(`file://${source}`, { waitUntil: "load" });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  console.log(`og.png ${WIDTH}x${HEIGHT} → ${out}`);
} finally {
  await browser.close();
}
