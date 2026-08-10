/**
 * `@react-lens/diagnostics` eagerly imports `oxc-parser` for AST-backed static
 * analysis, but oxc-parser's native/WASM binding isn't browser-bundleable. The
 * diagnostics layer already anticipates this: `analyzeSourceSmart` catches a
 * failing parse and falls back to its regex analyzer (the "browser without
 * WASM" path). We alias oxc-parser to this stub so the bundle resolves and that
 * intended fallback engages — without modifying the diagnostics package.
 */
export function parseSync(): never {
  throw new Error("oxc-parser is unavailable in the browser; using the regex fallback");
}
