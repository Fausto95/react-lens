import type { LensRef } from "@reactlens/explain";
import type { ToolName } from "@reactlens/agent-tools";

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

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; citations: LensRef[]; steps: AgentStep[] };

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

export interface ProviderTurn {
  text: string | null;
  toolCalls: import("@reactlens/agent-tools").ToolCall[];
  rawAssistant: unknown;
}

export type {
  ToolName,
  ToolCall,
  ToolHandlers,
  ToolArgsMap,
  ToolResultMap,
  ToolError,
  WhyToolResult,
  ComponentSourceResult,
  ComponentRuntimeResult,
  CauseSummary,
} from "@reactlens/agent-tools";
