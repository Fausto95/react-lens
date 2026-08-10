import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
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
  ],
  server: { port: 5178, host: true },
});
