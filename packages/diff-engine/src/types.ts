import type { SerializedValue, DOMSnapshot } from "@reactlens/protocol";

/**
 * The universal diff input. One engine handles every target via a strategy
 * table keyed by `kind` — no per-domain diff implementations. The union is
 * open: css | visual | tree | performance slot in later without touching the
 * value/DOM core.
 */
export type DiffTarget =
  | { kind: "value"; before: SerializedValue; after: SerializedValue }
  | { kind: "props"; before: SerializedValue; after: SerializedValue }
  | { kind: "state"; before: SerializedValue; after: SerializedValue }
  | { kind: "context"; before: SerializedValue; after: SerializedValue }
  | { kind: "hooks"; before: SerializedValue; after: SerializedValue }
  | { kind: "dom"; before: DOMSnapshot; after: DOMSnapshot };

export type DiffTargetKind = DiffTarget["kind"];

export type ChangeKind =
  | "UNCHANGED"
  | "VALUE_CHANGED"
  | "REFERENCE_ONLY_CHANGED"
  | "FUNCTION_IDENTITY_CHANGED"
  | "STRUCTURE_CHANGED"
  | "ADDED"
  | "REMOVED";

export interface DiffChange {
  path: Array<string | number>;
  kind: ChangeKind;
  before?: SerializedValue;
  after?: SerializedValue;
  /** 0..1. Below 1 when we cannot prove behavioral equivalence (functions). */
  confidence: number;
}

export interface DiffSummary {
  changed: number;
  referenceOnly: number;
  /** DOM target only: did observable output actually change? */
  observableOutputChanged: boolean;
}

export interface DiffResult {
  target: DiffTargetKind;
  changes: DiffChange[];
  summary: DiffSummary;
}
