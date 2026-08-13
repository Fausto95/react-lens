import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
  optimizeDeps: {
    exclude: ["oxc-parser", "@oxc-parser/binding-wasm32-wasi"],
  },
  // The site inspects ITSELF with the real panel, so it ships as a production
  // React build: names are minified and no _debugStack exists. Publishing maps
  // lets the panel resolve components to src/... with their original names —
  // the demo then shows what the extension does on any deployed site.
  //
  // This flag alone is not enough on Vercel: Protected Source Maps (on by
  // default for new projects) answers 404 for *.js.map to unauthenticated
  // requests, so the panel silently degrades to compiled chunk positions. It
  // must also be turned off under Settings → Deployment Protection. Note that
  // doing so publishes this app's original sources, which Vite embeds in the
  // map as sourcesContent — fine here, the repo is public.
  build: { sourcemap: true },
  server: { port: 5179, host: true },
});
