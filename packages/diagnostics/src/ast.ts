import type { StaticFinding, AnalyzeSourceOptions } from "./static.js";
import { definitionSpan } from "./static.js";

export type ParseSync = (
  filename: string,
  source: string,
  opts: { sourceType: string; lang: string },
) => { program?: unknown };

/**
 * Prefer AST; fall back to regex when oxc fails to load (browser without WASM).
 * Always returns findings — never null.
 *
 * Browser: `import("oxc-parser")` resolves the package `browser` field → WASM
 * (`@oxc-parser/binding-wasm32-wasi`). Extension builds may stub oxc-parser so
 * this catch engages. Static analysis never blocks the trace path.
 */
export async function analyzeSourceSmart(
  source: string,
  opts: AnalyzeSourceOptions,
  regexFallback: (source: string, opts: AnalyzeSourceOptions) => StaticFinding[],
): Promise<StaticFinding[]> {
  try {
    const mod = await import("oxc-parser");
    return analyzeSourceAstWithParse(mod.parseSync as ParseSync, source, opts);
  } catch {
    return regexFallback(source, opts);
  }
}

/** Shared walker — Node (`analyzeSourceAst`) and browser (`analyzeSourceSmart`). */
export function analyzeSourceAstWithParse(
  parseSync: ParseSync,
  source: string,
  opts: AnalyzeSourceOptions = {},
): StaticFinding[] {
  const result = parseSync("component.tsx", source, { sourceType: "module", lang: "tsx" });
  const program = result.program as unknown as AstNode | undefined;
  if (!program) return [];

  const span = opts.name ? definitionSpan(source, opts.name) : undefined;
  const findings: StaticFinding[] = [];
  const lineOf = (offset: number) => source.slice(0, Math.max(0, offset)).split("\n").length;
  const inSpan = (line: number) => !span || (line >= span.startLine && line <= span.endLine);

  walk(program, (node) => {
    if (node.type === "JSXOpeningElement" && isProviderName(node.name)) {
      const valueAttr = (node.attributes as AstNode[] | undefined)?.find(
        (a) => a.type === "JSXAttribute" && (a.name as AstNode | undefined)?.name === "value",
      );
      const expr = (valueAttr?.value as AstNode | undefined)?.expression as AstNode | undefined;
      if (expr && (expr.type === "ObjectExpression" || expr.type === "ArrayExpression")) {
        const line = lineOf(typeof node.start === "number" ? node.start : 0);
        if (!inSpan(line)) return;
        findings.push(
          stamp(
            {
              ruleId: "inline-context-value",
              severity: "warn",
              title: "Context value is a fresh object each render",
              detail:
                "A Provider `value` is an inline object/array literal, so its identity changes every render — notifying all consumers.",
              line,
              fix: "Hoist the value or derive it once; with the React Compiler on, ensure it isn't recreated on every render.",
            },
            opts.file,
          ),
        );
      }
    }

    if (node.type === "CallExpression" && isUseEffectCallee(node.callee)) {
      const fn = (node.arguments as AstNode[] | undefined)?.[0];
      if (fn && isEffectDerivesState(fn)) {
        const line = lineOf(typeof node.start === "number" ? node.start : 0);
        if (!inSpan(line)) return;
        findings.push(
          stamp(
            {
              ruleId: "effect-derives-state",
              severity: "warn",
              title: "Effect derives state",
              detail:
                "An effect's first action is a state setter, which schedules another render for a value that could be computed during render.",
              line,
              fix: "Compute the value inline (or with useMemo) instead of syncing it in an effect.",
            },
            opts.file,
          ),
        );
      }
    }
  });

  return findings;
}

interface AstNode {
  type: string;
  start?: number;
  name?: string | AstNode;
  object?: AstNode;
  property?: AstNode;
  callee?: AstNode;
  arguments?: AstNode[];
  attributes?: AstNode[];
  value?: AstNode;
  expression?: AstNode;
  body?: AstNode | AstNode[];
  [key: string]: unknown;
}

function walk(node: AstNode, visit: (n: AstNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "tokens" || key === "comments") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === "object" && typeof (c as AstNode).type === "string") {
          walk(c as AstNode, visit);
        }
      }
    } else if (child && typeof child === "object" && typeof (child as AstNode).type === "string") {
      walk(child as AstNode, visit);
    }
  }
}

function isProviderName(name: AstNode | string | undefined): boolean {
  if (!name || typeof name === "string") return false;
  if (name.type === "JSXMemberExpression") {
    return (name.property as AstNode | undefined)?.name === "Provider";
  }
  return false;
}

function isUseEffectCallee(callee: AstNode | undefined): boolean {
  if (!callee) return false;
  if (callee.type === "Identifier") return callee.name === "useEffect";
  if (callee.type === "MemberExpression") {
    return (callee.property as AstNode | undefined)?.name === "useEffect";
  }
  return false;
}

function isEffectDerivesState(fn: AstNode): boolean {
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return false;
  const body = fn.body;
  if (!body) return false;
  if (!Array.isArray(body) && (body as AstNode).type === "CallExpression") {
    return isSetterCall(body as AstNode);
  }
  const stmts = Array.isArray(body)
    ? body
    : (body as AstNode).type === "BlockStatement"
      ? (((body as AstNode).body as AstNode[] | undefined) ?? [])
      : [];
  const first = stmts[0];
  if (!first) return false;
  if (first.type === "ExpressionStatement") return isSetterCall(first.expression as AstNode);
  if (first.type === "CallExpression") return isSetterCall(first);
  return false;
}

function isSetterCall(node: AstNode | undefined): boolean {
  if (!node || node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (!callee) return false;
  if (callee.type === "Identifier" && typeof callee.name === "string") {
    return /^set[A-Z]/.test(callee.name);
  }
  return false;
}

function stamp(f: StaticFinding, file?: string): StaticFinding {
  if (!file || f.line == null) return f;
  return { ...f, source: { file, line: f.line, column: 0 } };
}
