/**
 * Typed query protocol for the trace worker — viewport-bounded reads.
 * Analysis (causality/diff) must not block ingest; those are separate queries.
 */

import type { ComponentId, RenderId } from "@reactlens/protocol";
import type {
  HitTestResult,
  TimelineQuery,
  TimelineQueryResult,
  VisibleTreeRow,
} from "@reactlens/trace-engine";
import type { CommitSummary } from "@reactlens/trace-engine";
import type { WhyResult } from "@reactlens/causality";
import type { ComponentInstance, RenderEvent, RenderSnapshot } from "@reactlens/protocol";

export type TraceQuery =
  | ({ kind: "timeline-range" } & TimelineQuery)
  | { kind: "hit-test"; t: number; laneKey?: string | null }
  | { kind: "render"; id: RenderId }
  | { kind: "component-renders"; componentId: ComponentId; t0?: number; t1?: number }
  | { kind: "tree-window"; scrollTop: number; viewH: number; expanded: string[]; projection?: "all" | "changed" | "waste"; rowHeight?: number }
  | { kind: "apply-set-delta"; t: number; prevT?: number }
  | { kind: "time-bounds" }
  | { kind: "stats-range"; t0: number; t1: number; excludeWasted?: boolean }
  | { kind: "why"; id: RenderId }
  | { kind: "instance"; id: ComponentId }
  | { kind: "snapshot"; id: RenderId }
  | { kind: "commits" };

export type TraceQueryResult =
  | { kind: "timeline-range"; result: TimelineQueryResult }
  | { kind: "hit-test"; result: HitTestResult | null }
  | { kind: "render"; result: RenderEvent | undefined }
  | { kind: "component-renders"; result: RenderEvent[] }
  | {
      kind: "tree-window";
      result: { rows: VisibleTreeRow[]; totalRows: number; totalHeight: number };
    }
  | {
      kind: "apply-set-delta";
      result: Array<{ componentId: ComponentId; renderId: RenderId }>;
    }
  | { kind: "time-bounds"; result: { t0: number; t1: number } }
  | { kind: "stats-range"; result: { renders: number; wasted: number; selfMs: number } }
  | { kind: "why"; result: WhyResult }
  | { kind: "instance"; result: ComponentInstance | undefined }
  | { kind: "snapshot"; result: RenderSnapshot | undefined }
  | { kind: "commits"; result: CommitSummary[] };

export type TraceQueryMessage = {
  type: "query";
  requestId: number;
  query: TraceQuery;
};

export type TraceQueryReplyMessage = {
  type: "query-result";
  requestId: number;
  result: TraceQueryResult;
  error?: string;
};

/** Diff worker on-demand request. */
export type DiffQuery =
  | {
      kind: "commit-diff";
      componentId: ComponentId;
      renderA: RenderId;
      renderB: RenderId;
    };

export type CausalityJob = {
  type: "analyze-renders";
  renderIds: RenderId[];
};

export type CausalityResult = {
  type: "flags";
  /** Renders with no-observable-change. */
  wasted: RenderId[];
  /** Renders with expected DOM change. */
  expected: RenderId[];
};
