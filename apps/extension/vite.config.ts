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
      // oxc-parser WASM isn't browser-bundleable (worker or main). Stub it so
      // analyzeSourceSmart falls back to regex — including in doctorWorker.
      {
        find: "oxc-parser",
        replacement: new URL("./src/oxc-stub.ts", import.meta.url).pathname,
      },
    ],
  },
  plugins: lazyPlugins(() => [
    react({
      // The panel is React 19 written for the Compiler — no hand-written
      // `useCallback`/`memo` anywhere (see the repo's engineering rules), so
      // without this every handler and child re-rendered with nothing
      // collecting the debt. Compiling covers the extension shell and the
      // devtools package it renders.
      //
      // Files that key memos on the trace store's version counter opt out with
      // `"use no memo"`, and say why at the top of each.
      babel: {
        plugins: [
          [
            "babel-plugin-react-compiler",
            {
              target: "19",
              sources: (filename: string) =>
                filename.includes("/apps/extension/") || filename.includes("/apps/devtools/"),
            },
          ],
        ],
      },
    }),
    crx({ manifest: manifest as never }),
  ]),
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
