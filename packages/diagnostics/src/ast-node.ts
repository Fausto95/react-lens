// Node-only entry — browser graphs import `analyzeSourceSmart` from `./ast.js`.
// @ts-expect-error — `@types/node` may be ambient-only in this package's tsconfig
import { createRequire } from "node:module";
import type { AnalyzeSourceOptions, StaticFinding } from "./static.js";
import { analyzeSourceAstWithParse, type ParseSync } from "./ast.js";

/**
 * Node-only AST entry. Lives in a separate module so browser bundles that only
 * import `analyzeSourceSmart` never pull in `node:module`.
 */
export function analyzeSourceAst(source: string, opts: AnalyzeSourceOptions = {}): StaticFinding[] {
  const require = createRequire(import.meta.url);
  const { parseSync } = require("oxc-parser") as { parseSync: ParseSync };
  return analyzeSourceAstWithParse(parseSync, source, opts);
}
