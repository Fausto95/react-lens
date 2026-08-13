import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const oxcStub = path.resolve(here, "src/oxc-stub.ts");
const nodeModuleStub = path.resolve(here, "src/node-module-stub.ts");

export default defineConfig({
  resolve: {
    alias: [
      { find: "oxc-parser", replacement: oxcStub },
      { find: "@oxc-parser/binding-wasm32-wasi", replacement: oxcStub },
      { find: "node:module", replacement: nodeModuleStub },
    ],
  },
  plugins: lazyPlugins(() => [
    react({
      // The React Compiler runs over every workspace source, matching how the
      // real extension builds the panel. No file opts out, including the
      // scenarios: their waste has to be waste the Compiler cannot remove, or
      // the demo is showing a problem that no longer exists.
      // oxc-parser is stubbed; Doctor falls back to regex when unavailable.
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
  optimizeDeps: {
    exclude: ["oxc-parser", "@oxc-parser/binding-wasm32-wasi"],
  },
  server: { port: 5178, host: true },
});
