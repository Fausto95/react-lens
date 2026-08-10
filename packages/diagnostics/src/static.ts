import type { Severity } from "./types.js";
import type { SourceLocation } from "@react-lens/protocol";

export interface StaticFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  /** 1-based line in the original source. */
  line?: number;
  /** Definition-attributed location (file + line) when available. */
  source?: SourceLocation;
  fix?: string;
}

export interface AnalyzeSourceOptions {
  /** Restrict findings to this component's definition span. */
  name?: string;
  /** Original file path (from source map) stamped onto each finding. */
  file?: string;
}

/**
 * Heuristic static analysis over ORIGINAL source (pre-compile, from the source
 * map's sourcesContent). Regex-based v1 — cheap and dependency-free; a full
 * OXC/AST pass would make these robust and is the next layer. Rules combine
 * with runtime evidence in the Doctor.
 *
 * When `opts.name` is set, only lines inside that component's definition span
 * are considered — so siblings in the same module don't pollute the finding.
 */
export function analyzeSource(source: string, opts: AnalyzeSourceOptions = {}): StaticFinding[] {
  const lines = source.split("\n");
  const span = opts.name ? definitionSpan(source, opts.name) : undefined;
  const findings: StaticFinding[] = [];

  lines.forEach((text, i) => {
    const line = i + 1;
    if (span && (line < span.startLine || line > span.endLine)) return;

    // Inline context value: a Provider given a fresh object/array literal each
    // render → its identity churns, re-rendering every consumer.
    if (/\.Provider\b[^>]*\bvalue=\{\{/.test(text) || /\.Provider\b[^>]*\bvalue=\{\[/.test(text)) {
      findings.push(stamp({
        ruleId: "inline-context-value",
        severity: "warn",
        title: "Context value is a fresh object each render",
        detail: "A Provider `value` is an inline object/array literal, so its identity changes every render — notifying all consumers.",
        line,
        fix: "Hoist the value or derive it once; with the React Compiler on, ensure it isn't recreated on every render.",
      }, opts.file));
    }

    // Effect that only derives state: useEffect whose body immediately calls a
    // setter → an extra render cycle for something computable inline.
    if (/useEffect\(\s*\(\)\s*=>\s*\{?\s*set[A-Z]\w*\(/.test(text)) {
      findings.push(stamp({
        ruleId: "effect-derives-state",
        severity: "warn",
        title: "Effect derives state",
        detail: "An effect's first action is a state setter, which schedules another render for a value that could be computed during render.",
        line,
        fix: "Compute the value inline (or with useMemo) instead of syncing it in an effect.",
      }, opts.file));
    }
  });

  return findings;
}

function stamp(f: StaticFinding, file?: string): StaticFinding {
  if (!file || f.line == null) return f;
  return { ...f, source: { file, line: f.line, column: 0 } };
}

/** 1-based line of a component's definition in the original source, if found. */
export function definitionLine(source: string, name: string): number | undefined {
  return definitionSpan(source, name)?.startLine;
}

/**
 * Approximate span of a component declaration: from its definition line to the
 * next top-level declaration or EOF. Brace-walk preferred when the body opens
 * on the same/next few lines.
 */
export function definitionSpan(
  source: string,
  name: string,
): { startLine: number; endLine: number } | undefined {
  const patterns = [
    new RegExp(`\\bfunction\\s+${escape(name)}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${escape(name)}\\s*[:=]`),
    new RegExp(`\\bclass\\s+${escape(name)}\\b`),
  ];
  const lines = source.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]!))) {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;

  // Brace-walk from the first `{` after the definition.
  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < lines.length; i++) {
    const text = lines[i]!;
    for (const ch of text) {
      if (ch === "{") {
        depth++;
        seenBrace = true;
      } else if (ch === "}") {
        depth--;
        if (seenBrace && depth === 0) {
          return { startLine: start + 1, endLine: i + 1 };
        }
      }
    }
    // No braces yet — stop at the next top-level declaration (arrow one-liners).
    if (!seenBrace && i > start && isTopLevelDecl(text)) {
      return { startLine: start + 1, endLine: i };
    }
  }
  return { startLine: start + 1, endLine: lines.length };
}

function isTopLevelDecl(text: string): boolean {
  return /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\b/.test(text);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
