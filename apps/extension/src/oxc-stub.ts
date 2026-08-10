/**
 * `@react-lens/diagnostics` imports `oxc-parser` for AST static analysis, but
 * oxc's native/WASM binding isn't browser-bundleable. `analyzeSourceSmart`
 * catches a failing parse and falls back to regex — alias oxc-parser here so
 * the Vite bundle resolves and that fallback engages.
 */
export function parseSync(): never {
  throw new Error("oxc-parser is unavailable in the browser; using the regex fallback");
}
