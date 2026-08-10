import type { Severity } from "./types.js";

export interface StaticFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  /** 1-based line in the original source. */
  line?: number;
  fix?: string;
}

/**
 * Heuristic static analysis over ORIGINAL source (pre-compile, from the source
 * map's sourcesContent). Regex-based v1 — cheap and dependency-free; a full
 * OXC/AST pass would make these robust and is the next layer. Rules combine
 * with runtime evidence in the Doctor.
 */
export function analyzeSource(source: string): StaticFinding[] {
  const lines = source.split("\n");
  const findings: StaticFinding[] = [];

  lines.forEach((text, i) => {
    const line = i + 1;

    // Inline context value: a Provider given a fresh object/array literal each
    // render → its identity churns, re-rendering every consumer.
    if (/\.Provider\b[^>]*\bvalue=\{\{/.test(text) || /\.Provider\b[^>]*\bvalue=\{\[/.test(text)) {
      findings.push({
        ruleId: "inline-context-value",
        severity: "warn",
        title: "Context value is a fresh object each render",
        detail: "A Provider `value` is an inline object/array literal, so its identity changes every render — notifying all consumers.",
        line,
        fix: "Hoist the value or derive it once; with the React Compiler on, ensure it isn't recreated on every render.",
      });
    }

    // Effect that only derives state: useEffect whose body immediately calls a
    // setter → an extra render cycle for something computable inline.
    if (/useEffect\(\s*\(\)\s*=>\s*\{?\s*set[A-Z]\w*\(/.test(text)) {
      findings.push({
        ruleId: "effect-derives-state",
        severity: "warn",
        title: "Effect derives state",
        detail: "An effect's first action is a state setter, which schedules another render for a value that could be computed during render.",
        line,
        fix: "Compute the value inline (or with useMemo) instead of syncing it in an effect.",
      });
    }
  });

  return findings;
}

/** 1-based line of a component's definition in the original source, if found. */
export function definitionLine(source: string, name: string): number | undefined {
  const patterns = [
    new RegExp(`\\bfunction\\s+${escape(name)}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${escape(name)}\\s*[:=]`),
    new RegExp(`\\bclass\\s+${escape(name)}\\b`),
  ];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]!))) return i + 1;
  }
  return undefined;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
