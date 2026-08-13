import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.json" with { type: "json" };

// @crxjs handles MV3: manifest emission, HTML devtools/panel entries, and the
// classic-script bundling required for the MAIN- and ISOLATED-world content
// scripts.
export default defineConfig({
  resolve: {
    alias: [
      // Chrome extension workers cannot reliably load oxc-parser WASM
      // (chrome-extension:// CSP + WASI threads). Stub so analyzeSourceSmart
      // falls back to regex. Playground / e2e-fixture / site leave oxc unstubbed.
      {
        find: "oxc-parser",
        replacement: new URL("./src/oxc-stub.ts", import.meta.url).pathname,
      },
    ],
  },
  plugins: lazyPlugins(() => [
    react({
      // The React Compiler runs over every workspace source. The panel is
      // written for it — no hand-written `useCallback`/`memo` anywhere (see the
      // repo's engineering rules) — so without this every handler and child
      // re-rendered with nothing collecting the debt.
      //
      // No file opts out. Reads of the trace store go through `readFresh` /
      // `derivationCache` (keyed on the store version), which put the version
      // counter where the Compiler can see it; the old `useDerived` hook and
      // `"use no memo"` directives those replaced are gone.
      babel: {
        plugins: [
          [
            "babel-plugin-react-compiler",
            {
              target: "19",
              sources: (filename: string) =>
                filename.includes("/apps/") || filename.includes("/packages/"),
            },
          ],
        ],
      },
    }),
    crx({ manifest: manifest as never }),
  ]),
  optimizeDeps: {
    exclude: ["oxc-parser", "@oxc-parser/binding-wasm32-wasi"],
  },
  build: {
    target: "chrome116",
    // Chrome 116 supports native ESM + <link rel=modulepreload>, so the polyfill
    // is dead weight. Disabling it also stops Vite injecting cross-world
    // modulepreload hints into the devtools/panel HTML — those resources load in
    // a different extension world and Chrome warns they're preloaded-but-unused.
    modulePreload: false,
    rollupOptions: {
      input: {
        devtools: "src/devtools/devtools.html",
        panel: "src/panel/panel.html",
      },
    },
  },
});
