import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";

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
      // React Compiler on for the SITE's own source only (DESIGN §1.4), matching
      // the playground: the marketing sections then show ◆ compiled in the panel
      // that inspects them, and the compiler never touches the panel's own
      // external-store reads (which would freeze the UI).
      babel: {
        plugins: [
          [
            "babel-plugin-react-compiler",
            { target: "19", sources: (filename: string) => filename.includes("/apps/site/") },
          ],
        ],
      },
    }),
  ]),
  server: { port: 5179, host: true },
});
