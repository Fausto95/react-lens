export { analyze, analyzeOne, RULES } from "./rules.js";
export {
  analyzeSource,
  definitionLine,
  definitionSpan,
  type StaticFinding,
  type AnalyzeSourceOptions,
} from "./static.js";
export { analyzeSourceSmart } from "./ast.js";
// Node-only `analyzeSourceAst` lives in `./ast-node.ts` — do not re-export it
// from the package root or browser/worker bundles pull in `node:module`.
export { mergeStaticAndRuntime, type FuseEvidence } from "./fuse.js";
export type { Diagnostic, DiagnosticInput, LatestRenderEvidence, Rule, Severity } from "./types.js";
