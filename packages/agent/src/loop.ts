import type { LensRef } from "@reactlens/explain";
import {
  executeTool,
  collectCitations,
  dedupeCitations,
  type ToolHandlers,
  type ToolCall,
} from "@reactlens/agent-tools";
import { SYSTEM_PROMPT } from "./prompt.js";
import {
  appendAssistant,
  appendToolResults,
  providerComplete,
  startTranscript,
  testProviderConnection,
} from "./chat.js";
import { PROVIDER_PRESETS } from "./providers.js";
import type { AgentAnswer, AgentSettings, AgentStep } from "./types.js";

const MAX_STEPS = 6;

/**
 * Closed-tool agent loop. Supports OpenAI-compatible (incl. ZML/LLMD) and
 * Anthropic Claude. Keys never leave the machine except as auth to baseUrl.
 */
export async function runAgent(opts: {
  settings: AgentSettings;
  question: string;
  handlers: ToolHandlers;
  signal?: AbortSignal;
  onStep?: (step: AgentStep) => void;
}): Promise<AgentAnswer> {
  const { settings, question, handlers, signal, onStep } = opts;
  const preset = PROVIDER_PRESETS[settings.provider];
  if (preset.keyRequired && !settings.apiKey.trim()) {
    throw new Error(`Missing API key for ${preset.label} — add one in Settings (BYOK).`);
  }

  const transcript = startTranscript(SYSTEM_PROMPT, question, settings);
  const steps: AgentStep[] = [];
  const citations: LensRef[] = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const turn = await providerComplete(settings, transcript, signal);
    appendAssistant(transcript, turn);

    if (turn.toolCalls.length === 0) {
      const text = turn.text?.trim() || "No answer.";
      const step: AgentStep = { role: "assistant", content: text };
      steps.push(step);
      onStep?.(step);
      return { text, citations: dedupeCitations(citations), steps };
    }

    const toolResults: Array<{ id: string; name: string; content: string }> = [];
    for (const call of turn.toolCalls) {
      const result = await executeTool(handlers, call);
      collectCitations(result, citations);
      const content = safeJson(result);
      const step: AgentStep = { role: "tool", name: call.name, content: truncate(content, 4000) };
      steps.push(step);
      onStep?.(step);
      toolResults.push({ id: call.id, name: call.name, content });
    }
    appendToolResults(transcript, toolResults);
  }

  const text = "Stopped after max tool steps. See tool results above.";
  steps.push({ role: "assistant", content: text });
  return { text, citations: dedupeCitations(citations), steps };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "unserializable" });
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export { executeTool, collectCitations, dedupeCitations };
export type { ToolCall };
export { testProviderConnection as testAgentConnection };
