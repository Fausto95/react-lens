import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["**/dist/**", "**/*.zip", "pnpm-lock.yaml"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "**/*.zip", "pnpm-lock.yaml"],
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
