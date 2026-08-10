import type { ComponentId } from "@react-lens/protocol";
import type { Diagnostic } from "./types.js";
import type { StaticFinding } from "./static.js";

export interface FuseEvidence {
  componentId: ComponentId;
  /** Total self time (ms) attributable to this component in the window. */
  selfTime: number;
  renders: number;
  suspiciousRenders?: number;
}

/**
 * Merge static AST/regex findings with runtime diagnostics, attaching impact
 * from runtime evidence so static issues sort with Doctor's cost ranking.
 */
export function mergeStaticAndRuntime(
  staticFindings: StaticFinding[],
  runtime: Diagnostic[],
  evidence: FuseEvidence,
): Diagnostic[] {
  const fused: Diagnostic[] = runtime.map((d) => ({ ...d }));
  const seen = new Set(fused.map((d) => d.ruleId));

  for (const f of staticFindings) {
    if (seen.has(f.ruleId)) {
      // Boost matching runtime diagnostic impact when static confirms it.
      const hit = fused.find((d) => d.ruleId === f.ruleId);
      if (hit) {
        hit.impact += impactFor(f.ruleId, evidence) * 0.25;
        if (f.source && !hit.source) hit.source = f.source;
        if (f.fix && !hit.fix) hit.fix = f.fix;
      }
      continue;
    }
    seen.add(f.ruleId);
    fused.push({
      ruleId: f.ruleId,
      componentId: evidence.componentId,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      impact: impactFor(f.ruleId, evidence),
      ...(f.fix ? { fix: f.fix } : {}),
      ...(f.source ? { source: f.source } : {}),
    });
  }

  fused.sort((a, b) => b.impact - a.impact);
  return fused;
}

function impactFor(ruleId: string, evidence: FuseEvidence): number {
  const base = evidence.selfTime + evidence.renders * 0.5;
  switch (ruleId) {
    case "inline-context-value":
      // Fanout cost: treat as high leverage when many renders exist.
      return base + evidence.renders * 2 + (evidence.suspiciousRenders ?? 0);
    case "effect-derives-state":
      return base + evidence.renders * 1.5 + 3;
    default:
      return Math.max(1, base);
  }
}
