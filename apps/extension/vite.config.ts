import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.json";

// @crxjs handles MV3: manifest emission, HTML devtools/panel entries, and the
// classic-script bundling required for the MAIN- and ISOLATED-world content
// scripts.
export default defineConfig({
  resolve: {
    alias: [
      // oxc-parser isn't browser-bundleable; diagnostics falls back to regex.
      {
        find: "oxc-parser",
        replacement: new URL("./src/oxc-stub.ts", import.meta.url).pathname,
      },
    ],
  },
  plugins: [react(), crx({ manifest: manifest as never })],
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
