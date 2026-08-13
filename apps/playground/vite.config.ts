import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: lazyPlugins(() => [
    react({
      // The React Compiler runs over every workspace source, matching how the
      // real extension builds the panel. No file opts out, including the
      // scenarios: their waste has to be waste the Compiler cannot remove, or
      // the demo is showing a problem that no longer exists.
      // oxc-parser loads dynamically; Doctor falls back to regex when unavailable.
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
