/**
 * `@reactlens/diagnostics` imports `oxc-parser` for AST static analysis, but
 * oxc's WASM binding uses top-level await and cannot ship in a Vite worker
 * IIFE. `analyzeSourceSmart` catches a failing parse and falls back to regex.
 */
export function parseSync(): never {
  throw new Error("oxc-parser is unavailable in the browser; using the regex fallback");
}
