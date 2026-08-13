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
      // The React Compiler runs over every workspace source, matching how the
      // real extension builds the panel. No file opts out, including the
      // scenarios: their waste has to be waste the Compiler cannot remove, or
      // the demo is showing a problem that no longer exists.
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
  ]),
  server: { port: 5178, host: true },
});
