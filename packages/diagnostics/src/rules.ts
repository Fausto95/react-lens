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

function formatMs(value: number): string {
  if (value <= 0) return "0ms";
  if (value < 0.1) return `${value.toFixed(2)}ms`;
  if (value < 10) return `${value.toFixed(1)}ms`;
  return `${Math.round(value)}ms`;
}

function joinEvidence(parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
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

/** Last commit: rendered with no observable output. */
const wastedRender: Rule = {
  id: "wasted-render",
  evaluate(input) {
    const latest = input.latest;
    if (!latest?.wasted) return null;
    return base(
      input,
      "wasted-render",
      "severe",
      "Rendered with no observable output change",
      joinEvidence([
        latest.reasonSummary,
        latest.ownValueChanged
          ? "Captured values changed, but output stayed the same."
          : "Props, state and consumed context are unchanged.",
        latest.cascadeSize > 0
          ? `It still sits above ${latest.cascadeSize} downstream render${latest.cascadeSize === 1 ? "" : "s"}.`
          : "It did not cause additional downstream renders.",
      ]),
      120 + latest.cascadeSize * 3 + latest.renderMs,
      "This render is a candidate to stop at its source.",
    );
  },
};

/** Last commit: structurally equal values with new references. */
const identityChurn: Rule = {
  id: "identity-churn",
  evaluate(input) {
    const latest = input.latest;
    if (!latest || latest.identityKeys.length === 0) return null;
    const keys = latest.identityKeys.join(", ");
    const verb = latest.identityKeys.length === 1 ? "is" : "are";
    return base(
      input,
      "identity-churn",
      "warn",
      "Referentially new, structurally identical value",
      joinEvidence([
        `${keys} ${verb} referentially new but structurally identical — same shape, new reference.`,
        "Structurally equal values with new references defeat memoized consumers.",
        latest.reasonSummary,
      ]),
      110 + latest.cascadeSize * 2 + latest.renderMs,
      "Stabilize the value at the producer.",
    );
  },
};

/** Last commit: React Compiler reported a bailout. */
const compilerBailout: Rule = {
  id: "compiler-bailout",
  evaluate(input) {
    const latest = input.latest;
    if (!latest?.compilerBailout) return null;
    return base(
      input,
      "compiler-bailout",
      "warn",
      "React Compiler could not memoize this component",
      joinEvidence([latest.compilerBailout, latest.reasonSummary]),
      105 + latest.cascadeSize * 2 + latest.renderMs,
      "Inspect the bailout reason before adding manual memoization.",
    );
  },
};

/** Last commit: a context invalidation fanned out downstream. */
const contextFanout: Rule = {
  id: "context-fanout",
  evaluate(input) {
    const latest = input.latest;
    if (!latest?.contextUpdate || latest.cascadeSize < 2) return null;
    return base(
      input,
      "context-fanout",
      "warn",
      `Context update fanned out through ${latest.cascadeSize} downstream renders`,
      joinEvidence([latest.reasonSummary]),
      90 + latest.cascadeSize * 4 + latest.renderMs,
      "Narrow the subscription or stabilize the provider value.",
    );
  },
};

/** Last commit: woke up only because a parent rendered. */
const parentCascade: Rule = {
  id: "parent-cascade",
  evaluate(input) {
    const latest = input.latest;
    if (!latest?.parentOnly || latest.wasted) return null;
    return base(
      input,
      "parent-cascade",
      "info",
      "Woke up only because its parent rendered",
      joinEvidence([latest.reasonSummary, "No own props/state/context change was captured."]),
      75 + latest.cascadeSize * 2 + latest.renderMs,
      "Check whether this parent boundary is broader than it needs to be.",
    );
  },
};

/** Last commit: an external-store subscription invalidated the component. */
const externalStore: Rule = {
  id: "external-store",
  evaluate(input) {
    const latest = input.latest;
    if (!latest?.externalStore) return null;
    return base(
      input,
      "external-store",
      "warn",
      "Rendered because an external-store subscription invalidated it",
      joinEvidence([latest.reasonSummary]),
      80 + latest.cascadeSize * 2 + latest.renderMs,
      "Check selector granularity and whether the subscribed slice actually changed.",
    );
  },
};

/** Last commit: forceUpdate bypassed normal change detection. */
const forceUpdate: Rule = {
  id: "force-update",
  evaluate(input) {
    const latest = input.latest;
    if (!latest?.forceUpdate) return null;
    return base(
      input,
      "force-update",
      "severe",
      "Bypassed change detection with a forced update",
      joinEvidence([latest.reasonSummary]),
      100 + latest.renderMs,
      "Trace the forceUpdate caller; it prevents React from explaining the update through normal inputs.",
    );
  },
};

/** Last commit: effect work is material relative to the render. */
const effectHeavy: Rule = {
  id: "effect-heavy",
  evaluate(input) {
    const latest = input.latest;
    if (!latest) return null;
    if (latest.effectMs < 0.5 || latest.effectMs < Math.max(0.5, latest.renderMs)) return null;
    return base(
      input,
      "effect-heavy",
      "warn",
      `Spent ${formatMs(latest.effectMs)} in effects after rendering`,
      latest.effectLines.length > 0
        ? latest.effectLines.join(" · ")
        : "Effect work is at least as expensive as this component's render work.",
      70 + latest.effectMs * 4,
      "Inspect the effect dependencies and move non-reactive work out of the effect when possible.",
    );
  },
};

export const RULES: Rule[] = [
  renderFanout,
  unstableCallback,
  wastedRender,
  identityChurn,
  compilerBailout,
  contextFanout,
  parentCascade,
  externalStore,
  forceUpdate,
  effectHeavy,
];

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
