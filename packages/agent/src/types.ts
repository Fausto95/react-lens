import type { ComponentId, RenderId, SourceLocation } from "@reactlens/protocol";
import type { ValueSummary } from "./summarize.js";
import type { LensRef, Narrative } from "@reactlens/explain";
import type { Diagnostic } from "@reactlens/diagnostics";
import type { DiffChange, DiffSummary } from "@reactlens/diff-engine";
import type { InteractionMetrics } from "@reactlens/trace-engine";

/** BYOK chat provider. `zml` is Z.AI GLM (Anthropic-compatible). */
export type AgentProvider = "openai" | "anthropic" | "zml";

export interface AgentSettings {
  provider: AgentProvider;
  /** API root. OpenAI/ZML: …/v1 ; Anthropic: https://api.anthropic.com */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AgentStep {
  role: "tool" | "assistant" | "system";
  name?: string;
  content: string;
}

export interface AgentAnswer {
  text: string;
  citations: LensRef[];
  steps: AgentStep[];
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
}

export type ToolName = keyof ToolArgsMap;

export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

// ── Tool results ──────────────────────────────────────────────────────────────

/** Every tool can answer with a recoverable error the model can act on. */
export interface ToolError {
  error: string;
}

export interface CauseSummary {
  level: 1 | 2 | 3;
  explanation: string;
  confidence: number;
  /** Present when the cause is backed by a value diff. */
  diffSummary?: DiffSummary;
  /** First few concrete changes: which path, what kind of change. */
  topChanges?: Array<{ path: string; kind: string }>;
  /** Where the cause originates (e.g. the re-rendering parent's definition). */
  source?: SourceLocation;
}

export interface WhyToolResult {
  renderId: number;
  componentId: ComponentId;
  componentName: string;
  verdict: "expected" | "no-observable-change" | "unknown";
  observableOutputChanged: boolean;
  compiler?: { compiled: boolean; memoized: boolean; bailoutReason?: string };
  causes: CauseSummary[];
  citations: LensRef[];
}

export interface QueryTraceResult {
  stats: { events: number; renders: number; snapshots: number; components: number };
  interaction: { id: string; label: string; kind: string; metrics: InteractionMetrics } | null;
  topRenders: Array<{ renderId: RenderId; componentId: ComponentId; name: string; self: number }>;
  citations: LensRef[];
}

export interface HooksDiffRow {
  index: number;
  hookKind: string;
  valueChanged: boolean;
  depsChanged: boolean;
}

export type DiffSnapshotsResult =
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
    };

export interface DiagnoseResult {
  componentId: ComponentId;
  name: string;
  diagnostics: Diagnostic[];
  citations: LensRef[];
}

export interface ResolveSourceResult {
  compiled: SourceLocation;
  original: SourceLocation | null;
  path: string | null;
  preview: string | null;
}

export interface FindComponentResult {
  matches: Array<{
    componentId: ComponentId;
    name: string;
    renders: number;
    totalSelf: number;
    source?: SourceLocation;
  }>;
  citations: LensRef[];
}

export interface ComponentRendersResult {
  componentId: ComponentId;
  componentName: string;
  renders: Array<{
    renderId: RenderId;
    timestamp: number;
    self: number;
    commitId: number;
    reasons: string[];
  }>;
  citations: LensRef[];
}

/** One-call runtime profile of a component — see handlers.ts::component_runtime. */
export interface ComponentRuntimeResult {
  componentId: ComponentId;
  componentName: string;
  kind: string;
  compiler: { compiled: boolean; memoized: boolean; bailoutReason?: string };
  source?: SourceLocation;
  stats: {
    /** Lifetime render count (uncapped). */
    renders: number;
    totalSelfMs: number;
    avgSelfMs: number;
    maxSelfMs: number;
    lastRenderId: RenderId | null;
    /** Retained renders whose output provably did not change. */
    wastedRenders: number;
    /** Latest render was caused by a function-identity-only prop change. */
    functionPropChurn: boolean;
  };
  /** RenderReason.type histogram over retained renders. */
  reasons: Record<string, number>;
  /** Summarized latest available snapshot, or null with snapshotReason. */
  latest: {
    renderId: RenderId;
    props: ValueSummary | null;
    hooks: Array<{ index: number; kind: string; value: ValueSummary | null; hasDeps: boolean }>;
    contexts: Array<{ name?: string; value: ValueSummary | null }>;
  } | null;
  snapshotReason?: string;
  citations: LensRef[];
}

export interface ComponentSourceResult {
  componentId: ComponentId;
  name: string;
  file: string | null;
  span?: { startLine: number; endLine: number };
  /** Line-numbered original source scoped to the definition, or null. */
  snippet: string | null;
  truncated: boolean;
  /** Why the snippet is missing/partial, when it is. */
  reason?: string;
  citations: LensRef[];
}

export interface EffectsSummaryResult {
  componentId: ComponentId;
  componentName: string;
  runs: number;
  cleanups: number;
  totalRunMs: number;
  /** Effect ran on nearly every recent render. */
  possibleLoop: boolean;
  hooks: Array<{ hookIndex: number; runs: number; totalMs: number }>;
  citations: LensRef[];
}

export interface GraphNeighborsResult {
  componentId: ComponentId;
  componentName: string;
  parents: Array<{ componentId: ComponentId; name: string }>;
  children: Array<{ componentId: ComponentId; name: string }>;
  citations: LensRef[];
}

export interface ToolResultMap {
  explain_interaction: Narrative;
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
}

export type ToolHandlers = {
  [K in ToolName]: (
    args: ToolArgsMap[K],
  ) => ToolResultMap[K] | ToolError | Promise<ToolResultMap[K] | ToolError>;
};

// ── Conversation ─────────────────────────────────────────────────────────────

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; citations: LensRef[]; steps: AgentStep[] };

/** Progress events emitted while a send() is in flight. */
export type AgentEvent =
  | { type: "model_start" }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: ToolName; args: Record<string, unknown> }
  | { type: "tool_result"; name: ToolName; summary: string; citations: LensRef[] }
  | { type: "done"; answer: AgentAnswer }
  | { type: "error"; message: string };

export interface AgentSession {
  send(
    question: string,
    opts?: { signal?: AbortSignal; onEvent?: (e: AgentEvent) => void },
  ): Promise<AgentAnswer>;
  readonly messages: ChatMessage[];
}

/** Normalized turn from any provider. */
export interface ProviderTurn {
  text: string | null;
  toolCalls: ToolCall[];
  /** Opaque assistant message to echo back on the next request. */
  rawAssistant: unknown;
}

export type { ComponentId, RenderId };
