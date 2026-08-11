import type { EventId, RenderEvent, SourceLocation } from "@reactlens/protocol";
import type { DiffResult } from "@reactlens/diff-engine";

export interface TraceEdge {
  from: EventId;
  to: EventId;
  type: "triggered" | "scheduled" | "rendered" | "committed" | "requested" | "resolved";
  /** solid ≈ 1 (proven), lower = inferred. */
  confidence: number;
}

/**
 * A single cause for a render, at one of three progressive-disclosure levels
 * (DESIGN §5): 1 = parent rerendered, 2 = what state/context/props changed,
 * 3 = the originating call site + event.
 */
export interface Cause {
  level: 1 | 2 | 3;
  explanation: string;
  confidence: number;
  diff?: DiffResult;
  sourceLocation?: SourceLocation;
}

export interface WhyResult {
  render: RenderEvent;
  causes: Cause[];
  /**
   * From the DOM diff. When false, the render produced no observable output —
   * the basis for calling it "potentially avoidable" (never "unnecessary").
   */
  observableOutputChanged: boolean;
  /** Overall verdict language, human-facing. */
  verdict: "expected" | "no-observable-change" | "unknown";
}
