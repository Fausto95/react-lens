import { defineConfig } from "vite-plus";

/**
 * Builds the MAIN-world bridge as a single self-contained IIFE (`dist/injected.js`).
 *
 * It is deliberately NOT a @crxjs content script: crxjs wraps content scripts in
 * an `await import(chrome.runtime.getURL(...))` loader, but MAIN-world scripts
 * have no `chrome.*` APIs, so that loader throws `chrome is not defined` and the
 * bridge never runs. Instead the background injects this bundle natively via
 * chrome.scripting at document_start, which needs no page-side chrome APIs.
 */
export default defineConfig({
  build: {
    target: "chrome116",
    // Emitted into the same dist/ as the crxjs build, so don't wipe it.
    emptyOutDir: false,
    outDir: "dist",
    lib: {
      entry: "src/injected/injected.ts",
      formats: ["iife"],
      name: "ReactLensInjected",
      fileName: () => "injected.js",
    },
    minify: false,
  },
});
