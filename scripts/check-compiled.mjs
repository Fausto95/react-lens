#!/usr/bin/env node
/**
 * Guard the React Compiler's coverage.
 *
 * Two failure modes, both silent:
 *
 *  1. A `"use no memo"` directive creeps back in. Each one leaves a whole file
 *    uncompiled, and the panel's files are the expensive ones. Reads of the
 *    trace store belong in `traceFresh` / `readFresh`, which put the version
 *    counter where the Compiler can see it — that is what the directives were
 *    working around.
 *  2. The build stops compiling altogether — a plugin ordering change, a
 *    `sources` filter that no longer matches — and nothing fails. The panel just
 *    gets slower. So we also assert the built bundle carries the Compiler's
 *    runtime marker.
 *
 * TODO(phase5-ratchet): once we can count compiled vs uncompiled components in
 * the bundle (or via Compiler instrumentation), add a percentage floor and
 * ratchet it upward in CI. Until then the marker presence check below is the
 * hard gate; oxlint `react/react-compiler` catches source-level bailouts.
 *
 * Usage: `node scripts/check-compiled.mjs [--bundle <dir>]`
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "test-results", ".pnpm-store"]);
const SOURCE_EXT = /\.(ts|tsx)$/;
/** The Compiler's cache sentinel, emitted into every function it optimises. */
const COMPILED_MARKERS = ["memo_cache_sentinel", "useMemoCache"];

async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (SOURCE_EXT.test(entry.name)) yield path;
  }
}

const offenders = [];
for await (const path of sources(process.cwd())) {
  const text = await readFile(path, "utf8");
  // Only a real directive counts: prose about the directive is how this file
  // and the vite configs explain themselves.
  if (/^\s*["']use no memo["']\s*;?\s*$/m.test(text)) offenders.push(path);
}

if (offenders.length > 0) {
  console.error(
    "The React Compiler is opted out of in these files:\n" +
      offenders.map((p) => `  ${p}`).join("\n") +
      "\n\nTake store reads through `derivationCache` / `readFresh` instead — they make the\n" +
      "trace version a real dependency, which is what the directive was avoiding.",
  );
  process.exit(1);
}

const bundleFlag = process.argv.indexOf("--bundle");
if (bundleFlag !== -1) {
  const dir = process.argv[bundleFlag + 1];
  if (!dir) {
    console.error("--bundle needs a directory");
    process.exit(1);
  }
  let compiled = false;
  for await (const path of walkAll(dir)) {
    if (!path.endsWith(".js")) continue;
    const text = await readFile(path, "utf8");
    if (COMPILED_MARKERS.some((m) => text.includes(m))) {
      compiled = true;
      break;
    }
  }
  if (!compiled) {
    console.error(
      `No React Compiler output found in ${dir}. The build is shipping\n` +
        "unoptimized components — check the `sources` filter in the vite config.",
    );
    process.exit(1);
  }
  console.log(`React Compiler output present in ${dir}.`);
}

console.log("No `use no memo` directives.");

// Percentage ratchet (Phase 5): once we can count compiled components reliably
// in the bundle (memo_cache_sentinel sites / component names), assert a
// minimum share of panel components are compiled and bump the floor in CI.
// Until then the binary marker above is the healthcheck.

async function* walkAll(dir) {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkAll(path);
    else yield path;
  }
}
