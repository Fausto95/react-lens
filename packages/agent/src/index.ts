export { runAgent, testAgentConnection } from "./loop.js";
export { createAgentSession } from "./session.js";
export {
  createToolHandlers,
  TOOL_DEFINITIONS,
  TOOL_BUDGETS,
  TOOL_SCHEMA_VERSION,
  buildEvidencePack,
  formatEvidencePack,
  summarizeValue,
  executeTool,
  collectCitations,
  dedupeCitations,
  createDefaultDiagnose,
  diagnoseOne,
  diagnoseAll,
  type EvidencePack,
  type ValueSummary,
  type ToolHandlers,
  type ToolName,
  type ToolCall,
  type ToolError,
  type ToolArgsMap,
  type ToolResultMap,
  type CauseSummary,
  type WhyToolResult,
  type ComponentSourceResult,
  type ComponentRuntimeResult,
} from "@reactlens/agent-tools";
export {
  PROVIDER_PRESETS,
  defaultSettingsFor,
  normalizeProvider,
  usesAnthropicApi,
} from "./providers.js";
export { SYSTEM_PROMPT } from "./prompt.js";
export type {
  AgentSettings,
  AgentProvider,
  AgentAnswer,
  AgentStep,
  AgentEvent,
  AgentSession,
  ChatMessage,
} from "./types.js";
