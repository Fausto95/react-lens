import type { ComponentId, SourceLocation } from "@react-lens/protocol";

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
