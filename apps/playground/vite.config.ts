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
      // React Compiler on for the playground's own source AND the panel, which
      // now matches how the real extension builds it.
      //
      // The panel used to be excluded because compiling its external-store
      // reads froze the UI. That hazard is real but narrow: it only affects
      // files whose memos key on the trace version counter without reading it.
      // Those files opt out individually with `"use no memo"`, so the rest of
      // the panel gets compiled here exactly as it does in the extension.
      babel: {
        plugins: [
          [
            "babel-plugin-react-compiler",
            {
              target: "19",
              sources: (filename: string) =>
                filename.includes("/apps/playground/") || filename.includes("/apps/devtools/"),
            },
          ],
        ],
      },
    }),
  ]),
  server: { port: 5178, host: true },
});
