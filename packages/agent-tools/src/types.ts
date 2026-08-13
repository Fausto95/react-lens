import type { ComponentId, RenderId, SourceLocation } from "@reactlens/protocol";
import type { ValueSummary } from "./summarize.js";
import type { LensRef, Narrative } from "@reactlens/explain";
import type { Diagnostic } from "@reactlens/diagnostics";
import type { DiffChange, DiffSummary } from "@reactlens/diff-engine";
import type { InteractionMetrics } from "@reactlens/trace-engine";
import type { EvidencePack } from "./evidence.js";

/** Version stamped on every tool envelope so hosts and playbooks stay aligned. */
export const TOOL_SCHEMA_VERSION = 1 as const;

export interface ToolEnvelope {
  schemaVersion: typeof TOOL_SCHEMA_VERSION;
  truncated?: boolean;
  cursor?: string;
  /** Present when the result was truncated by the tool budget. */
  budgetNote?: string;
}

// ── Tool arguments ────────────────────────────────────────────────────────────

export interface ToolArgsMap {
  explain_interaction: { interactionId?: string };
  query_trace: { interactionId?: string; limit?: number };
  why: { renderId: number };
  diff_snapshots: {
    kind: "props" | "dom" | "state" | "hooks" | "context";
    beforeRenderId: number;
    afterRenderId: number;
  };
  diagnose: { componentId: number };
  resolve_source: { file: string; line: number; column: number };
  find_component: { name: string };
  component_renders: { componentId: number; limit?: number };
  component_runtime: { componentId: number };
  read_component_source: { componentId: number; contextLines?: number };
  effects_summary: { componentId: number };
  graph_neighbors: { componentId: number };
  list_interactions: { limit?: number };
  get_session_summary: Record<string, never>;
  list_components: { name?: string; limit?: number };
  get_waste_report: { limit?: number };
  diff_commits: { beforeCommitId: number; afterCommitId: number };
  query_events: {
    type?: string;
    componentId?: number;
    interactionId?: string;
    cursor?: string;
    limit?: number;
  };
  get_source_location: { lensId: string };
  diagnose_slowness: { interactionId?: string };
  find_wasted_renders: { limit?: number };
  why_did_component_render: { componentId: number };
  compare_sessions: { before: unknown; after: unknown };
}

export type ToolName = keyof ToolArgsMap;

export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

/** Every tool can answer with a recoverable error the model can act on. */
export interface ToolError {
  error: string;
  schemaVersion?: typeof TOOL_SCHEMA_VERSION;
}

export interface CauseSummary {
  level: 1 | 2 | 3;
  explanation: string;
  confidence: number;
  diffSummary?: DiffSummary;
  topChanges?: Array<{ path: string; kind: string }>;
  source?: SourceLocation;
}

export interface WhyToolResult extends ToolEnvelope {
  renderId: number;
  componentId: ComponentId;
  componentName: string;
  verdict: "expected" | "no-observable-change" | "unknown";
  observableOutputChanged: boolean;
  compiler?: { compiled: boolean; memoized: boolean; bailoutReason?: string };
  causes: CauseSummary[];
  citations: LensRef[];
}

export interface QueryTraceResult extends ToolEnvelope {
  stats: { events: number; renders: number; snapshots: number; components: number };
  interaction: {
    id: string;
    label: string;
    kind: string;
    metrics: InteractionMetrics;
  } | null;
  topRenders: Array<{
    renderId: RenderId;
    componentId: ComponentId;
    name: string;
    selfMs: number;
  }>;
  citations: LensRef[];
}

export interface HooksDiffRow {
  index: number;
  hookKind: string;
  valueChanged: boolean;
  depsChanged: boolean;
}

export type DiffSnapshotsResult = ToolEnvelope &
  (
    | {
        kind: "hooks";
        beforeRenderId: number;
        afterRenderId: number;
        hooks: HooksDiffRow[];
        changeCount: number;
      }
    | {
        kind: "props" | "dom" | "state" | "context";
        beforeRenderId: number;
        afterRenderId: number;
        summary: DiffSummary;
        changeCount: number;
        changes: DiffChange[];
      }
  );

export interface DiagnoseResult extends ToolEnvelope {
  componentId: ComponentId;
  name: string;
  diagnostics: Diagnostic[];
  citations: LensRef[];
}

export interface ResolveSourceResult extends ToolEnvelope {
  compiled: SourceLocation;
  original: SourceLocation | null;
  path: string | null;
  preview: string | null;
}

export interface FindComponentResult extends ToolEnvelope {
  matches: Array<{
    componentId: ComponentId;
    name: string;
    renders: number;
    totalSelfMs: number;
    source?: SourceLocation;
  }>;
  citations: LensRef[];
}

export interface ComponentRendersResult extends ToolEnvelope {
  componentId: ComponentId;
  componentName: string;
  renders: Array<{
    renderId: RenderId;
    timestampMs: number;
    selfMs: number;
    commitId: number;
    reasons: string[];
  }>;
  citations: LensRef[];
}

export interface ComponentRuntimeResult extends ToolEnvelope {
  componentId: ComponentId;
  componentName: string;
  kind: string;
  compiler: { compiled: boolean; memoized: boolean; bailoutReason?: string };
  source?: SourceLocation;
  stats: {
    renders: number;
    totalSelfMs: number;
    avgSelfMs: number;
    maxSelfMs: number;
    lastRenderId: RenderId | null;
    wastedRenders: number;
    functionPropChurn: boolean;
  };
  reasons: Record<string, number>;
  latest: {
    renderId: RenderId;
    props: ValueSummary | null;
    hooks: Array<{ index: number; kind: string; value: ValueSummary | null; hasDeps: boolean }>;
    contexts: Array<{ name?: string; value: ValueSummary | null }>;
  } | null;
  snapshotReason?: string;
  citations: LensRef[];
}

export interface ComponentSourceResult extends ToolEnvelope {
  componentId: ComponentId;
  name: string;
  file: string | null;
  span?: { startLine: number; endLine: number };
  snippet: string | null;
  truncated: boolean;
  reason?: string;
  citations: LensRef[];
}

export interface EffectsSummaryResult extends ToolEnvelope {
  componentId: ComponentId;
  componentName: string;
  runs: number;
  cleanups: number;
  totalRunMs: number;
  possibleLoop: boolean;
  hooks: Array<{ hookIndex: number; runs: number; totalMs: number }>;
  citations: LensRef[];
}

export interface GraphNeighborsResult extends ToolEnvelope {
  componentId: ComponentId;
  componentName: string;
  parents: Array<{ componentId: ComponentId; name: string }>;
  children: Array<{ componentId: ComponentId; name: string }>;
  citations: LensRef[];
}

export interface ListInteractionsResult extends ToolEnvelope {
  interactions: Array<{
    id: string;
    label: string;
    kind: string;
    durationMs: number;
    reactMs: number;
    renderCount: number;
  }>;
  citations: LensRef[];
}

export interface SessionSummaryResult extends ToolEnvelope {
  evidence: EvidencePack;
  citations: LensRef[];
}

export interface ListComponentsResult extends ToolEnvelope {
  components: Array<{
    componentId: ComponentId;
    name: string;
    renders: number;
    totalSelfMs: number;
    compiled: boolean;
    source?: SourceLocation;
  }>;
  citations: LensRef[];
}

export interface WasteReportResult extends ToolEnvelope {
  waste: Array<{
    componentId: ComponentId;
    name: string;
    renderId: RenderId;
    selfMs: number;
    source?: SourceLocation;
  }>;
  citations: LensRef[];
}

export interface DiffCommitsResult extends ToolEnvelope {
  beforeCommitId: number;
  afterCommitId: number;
  beforeSelfMs: number;
  afterSelfMs: number;
  deltaSelfMs: number;
  addedComponentIds: ComponentId[];
  removedComponentIds: ComponentId[];
  sharedComponentIds: ComponentId[];
  citations: LensRef[];
}

export interface QueryEventsResult extends ToolEnvelope {
  events: Array<{
    id: number;
    type: string;
    timestampMs: number;
    componentId?: number;
    interactionId?: number;
  }>;
  nextCursor: string | null;
  citations: LensRef[];
}

export interface SourceLocationResult extends ToolEnvelope {
  lensId: string;
  kind: "component" | "render" | "interaction" | "unknown";
  file: string | null;
  line: number | null;
  column: number | null;
  componentId?: ComponentId;
  citations: LensRef[];
}

export interface CompareSessionsResult extends ToolEnvelope {
  verdict: string;
  regressions: Array<{
    name: string;
    beforeRenderCount: number;
    afterRenderCount: number;
    renderDeltaPct: number;
    wasteDelta: number;
  }>;
  improvements: Array<{ name: string; renderDelta: number; wasteDelta: number }>;
  onlyBefore: string[];
  onlyAfter: string[];
  citations: LensRef[];
}

export interface SymptomVerdictResult extends ToolEnvelope {
  verdict: string;
  findings: Array<{
    kind: string;
    label: string;
    detail: string;
    lensId?: string;
    nextStep?: string;
  }>;
  citations: LensRef[];
  nextSteps: string[];
}

export type ExplainInteractionResult = Narrative & ToolEnvelope;

export interface ToolResultMap {
  explain_interaction: ExplainInteractionResult;
  query_trace: QueryTraceResult;
  why: WhyToolResult;
  diff_snapshots: DiffSnapshotsResult;
  diagnose: DiagnoseResult;
  resolve_source: ResolveSourceResult;
  find_component: FindComponentResult;
  component_renders: ComponentRendersResult;
  component_runtime: ComponentRuntimeResult;
  read_component_source: ComponentSourceResult;
  effects_summary: EffectsSummaryResult;
  graph_neighbors: GraphNeighborsResult;
  list_interactions: ListInteractionsResult;
  get_session_summary: SessionSummaryResult;
  list_components: ListComponentsResult;
  get_waste_report: WasteReportResult;
  diff_commits: DiffCommitsResult;
  query_events: QueryEventsResult;
  get_source_location: SourceLocationResult;
  diagnose_slowness: SymptomVerdictResult;
  find_wasted_renders: SymptomVerdictResult;
  why_did_component_render: SymptomVerdictResult;
  compare_sessions: CompareSessionsResult;
}

export type ToolHandlers = {
  [K in keyof ToolResultMap]: (
    args: ToolArgsMap[K],
  ) => ToolResultMap[K] | ToolError | Promise<ToolResultMap[K] | ToolError>;
};

export type { ComponentId, RenderId };
