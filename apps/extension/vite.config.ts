import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.json";

// @crxjs handles MV3: manifest emission, HTML devtools/panel entries, and the
// classic-script bundling required for the MAIN- and ISOLATED-world content
// scripts.
export default defineConfig({
  plugins: [react(), crx({ manifest: manifest as never })],
  build: {
    target: "chrome116",
    rollupOptions: {
      input: {
        devtools: "src/devtools/devtools.html",
        panel: "src/panel/panel.html",
      },
    },
  },
});
