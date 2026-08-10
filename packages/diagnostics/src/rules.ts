import type { Rule, DiagnosticInput, Diagnostic, Severity } from "./types.js";

const SUSPICIOUS_RATIO = 0.6;
const MIN_RENDERS = 4;

function base(
  input: DiagnosticInput,
  ruleId: string,
  severity: Severity,
  title: string,
  detail: string,
  impact: number,
  fix?: string,
): Diagnostic {
  return {
    ruleId,
    componentId: input.componentId,
    severity,
    title,
    detail,
    impact,
    ...(fix ? { fix } : {}),
    ...(input.source ? { source: input.source } : {}),
  };
}

/** Many renders, most producing no observable output. */
const renderFanout: Rule = {
  id: "render-fanout",
  evaluate(input) {
    if (input.renders < MIN_RENDERS) return null;
    const ratio = input.suspiciousRenders / input.renders;
    if (ratio < SUSPICIOUS_RATIO) return null;
    const impact = input.selfTime * ratio + input.suspiciousRenders;
    return base(
      input,
      "render-fanout",
      ratio > 0.85 ? "severe" : "suspicious",
      "Frequent renders with no visible change",
      `${input.suspiciousRenders} of ${input.renders} renders produced no observable DOM change.`,
      impact,
      "Trace the cause in the inspector — usually an unstable prop or a broad context/store update reaching this component.",
    );
  },
};

/** Re-rendered by a prop whose only change was a new function identity. */
const unstableCallback: Rule = {
  id: "unstable-callback",
  evaluate(input) {
    if (!input.functionPropChurn) return null;
    const impact = input.selfTime + input.renders * 0.5 + 2;
    const compilerNote = input.uncompiled
      ? " This component is not compiled by the React Compiler, so it can't stabilize the callback itself."
      : "";
    return base(
      input,
      "unstable-callback",
      "warn",
      "Re-rendered by an unstable callback prop",
      `A function prop received a new identity with no value change.${compilerNote}`,
      impact,
      input.uncompiled
        ? "Enable the React Compiler for this file, or lift/stabilize the callback at its source."
        : "Check why the parent recreates this callback despite compilation.",
    );
  },
};

export const RULES: Rule[] = [renderFanout, unstableCallback];

/** Run all rules over all inputs, ranked most-impactful first. */
export function analyze(inputs: DiagnosticInput[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const input of inputs) {
    for (const rule of RULES) {
      const d = rule.evaluate(input);
      if (d) out.push(d);
    }
  }
  return out.sort((a, b) => b.impact - a.impact);
}

/** Diagnostics for a single component. */
export function analyzeOne(input: DiagnosticInput): Diagnostic[] {
  return analyze([input]).filter((d) => d.componentId === input.componentId);
}
