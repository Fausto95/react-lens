import type { ComponentId, RenderId } from "@react-lens/protocol";
import type { LensRef } from "@react-lens/explain";

/** BYOK chat provider. `zml` is Z.AI GLM (Anthropic-compatible). */
export type AgentProvider = "openai" | "anthropic" | "zml";

export interface AgentSettings {
  provider: AgentProvider;
  /** API root. OpenAI/ZML: …/v1 ; Anthropic: https://api.anthropic.com */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AgentCitation {
  ref: LensRef;
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

export type ToolName =
  | "explain_interaction"
  | "query_trace"
  | "why"
  | "root_cause"
  | "diff_snapshots"
  | "diagnose"
  | "resolve_source";

export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

export interface ToolHandlers {
  explain_interaction: (args: { interactionId?: string }) => unknown | Promise<unknown>;
  query_trace: (args: { interactionId?: string; limit?: number }) => unknown | Promise<unknown>;
  why: (args: { renderId: number }) => unknown | Promise<unknown>;
  root_cause: (args: { renderId: number }) => unknown | Promise<unknown>;
  diff_snapshots: (args: {
    kind: "props" | "dom" | "state" | "hooks" | "context";
    beforeRenderId: number;
    afterRenderId: number;
  }) => unknown | Promise<unknown>;
  diagnose: (args: { componentId: number }) => unknown | Promise<unknown>;
  resolve_source: (args: {
    file: string;
    line: number;
    column: number;
  }) => unknown | Promise<unknown>;
}

/** Normalized turn from any provider. */
export interface ProviderTurn {
  text: string | null;
  toolCalls: ToolCall[];
  /** Opaque assistant message to echo back on the next request. */
  rawAssistant: unknown;
}

export type { ComponentId, RenderId };
