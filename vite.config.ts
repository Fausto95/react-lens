import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["**/dist/**", "**/*.zip", "pnpm-lock.yaml", "packages/demo-ui/**"],
    plugins: ["typescript", "react"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // Phase 5 — Compiler / hooks gates (oxlint native react plugin).
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "error",
      "react/react-compiler": "error",
    },
    overrides: [
      {
        files: ["**/*.test.ts", "**/*.test.tsx"],
        rules: {
          // Test fixtures reassign outer setters / touch refs during render on purpose.
          "react/react-compiler": "off",
        },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "**/*.zip", "pnpm-lock.yaml", "packages/demo-ui/**"],
    singleQuote: false,
    semi: true,
  },
  test: {
    // happy-dom for the DOM-snapshot diff tests; pure packages ignore it.
    environment: "happy-dom",
    include: ["packages/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
