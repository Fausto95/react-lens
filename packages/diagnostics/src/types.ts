import type { ComponentId, SourceLocation } from "@reactlens/protocol";

/**
 * Evidence from this component's last render, only when that render landed in
 * the latest commit. Session-level rules (fan-out, callback churn) ignore this.
 */
export interface LatestRenderEvidence {
  wasted: boolean;
  /** Paths that were referentially new but structurally equal (not functions). */
  identityKeys: string[];
  compilerBailout: string | null;
  contextUpdate: boolean;
  /** Woke up because a parent rendered; no own props/state/context change. */
  parentOnly: boolean;
  externalStore: boolean;
  forceUpdate: boolean;
  effectMs: number;
  renderMs: number;
  /** Downstream renders in the same commit under this component. */
  cascadeSize: number;
  reasonSummary: string;
  ownValueChanged: boolean;
  /** Up to a few `phase · hook #n · Xms` lines from the render window. */
  effectLines: string[];
}

/**
 * Runtime evidence for one component, assembled by the caller from the trace
 * store + causality. Rules are pure functions of this — no framework, no store.
 */
export interface DiagnosticInput {
  componentId: ComponentId;
  name: string;
  renders: number;
  /** Renders that produced no observable DOM change. */
  suspiciousRenders: number;
  selfTime: number;
  /** Latest render was caused by a function-identity-only prop change. */
  functionPropChurn: boolean;
  /** Component is not optimized by the React Compiler. */
  uncompiled: boolean;
  /**
   * Last render of this component, when it is in the latest commit.
   * Absent for components that did not render in that commit.
   */
  latest?: LatestRenderEvidence;
  source?: SourceLocation;
}

export type Severity = "info" | "warn" | "suspicious" | "severe";

export interface Diagnostic {
  ruleId: string;
  componentId: ComponentId;
  severity: Severity;
  title: string;
  detail: string;
  /** duration × frequency × confidence — used to rank (higher = fix first). */
  impact: number;
  /** Suggested direction; never recommends manual memoization under the compiler. */
  fix?: string;
  source?: SourceLocation;
}

export interface Rule {
  id: string;
  evaluate(input: DiagnosticInput): Diagnostic | null;
}
