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
  server: { port: 5201, host: "localhost" },
});
