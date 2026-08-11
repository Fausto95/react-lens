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
      // React Compiler on for the playground's OWN source only (DESIGN §1.4).
      // Excluding the devtools workspace package matches how the panel runs in
      // the real extension (uncompiled) and, crucially, keeps the compiler from
      // memoizing the panel's external-store reads (which would freeze the UI).
      babel: {
        plugins: [
          [
            "babel-plugin-react-compiler",
            { target: "19", sources: (filename: string) => filename.includes("/apps/playground/") },
          ],
        ],
      },
    }),
  ]),
  server: { port: 5178, host: true },
});
