import type { LensRef } from "@react-lens/explain";
import { SYSTEM_PROMPT } from "./tools.js";
import {
  appendAssistant,
  appendToolResults,
  providerComplete,
  startTranscript,
  testProviderConnection,
} from "./chat.js";
import { PROVIDER_PRESETS } from "./providers.js";
import type {
  AgentAnswer,
  AgentSettings,
  AgentStep,
  ToolCall,
  ToolHandlers,
} from "./types.js";

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

async function executeTool(handlers: ToolHandlers, call: ToolCall): Promise<unknown> {
  try {
    switch (call.name) {
      case "explain_interaction":
        return await handlers.explain_interaction({
          interactionId: str(call.arguments.interactionId),
        });
      case "query_trace":
        return await handlers.query_trace({
          interactionId: str(call.arguments.interactionId),
          limit: num(call.arguments.limit),
        });
      case "why":
        return await handlers.why({ renderId: num(call.arguments.renderId) ?? 0 });
      case "root_cause":
        return await handlers.root_cause({ renderId: num(call.arguments.renderId) ?? 0 });
      case "diff_snapshots":
        return await handlers.diff_snapshots({
          kind: (str(call.arguments.kind) as "props") ?? "props",
          beforeRenderId: num(call.arguments.beforeRenderId) ?? 0,
          afterRenderId: num(call.arguments.afterRenderId) ?? 0,
        });
      case "diagnose":
        return await handlers.diagnose({ componentId: num(call.arguments.componentId) ?? 0 });
      case "resolve_source":
        return await handlers.resolve_source({
          file: str(call.arguments.file) ?? "",
          line: num(call.arguments.line) ?? 0,
          column: num(call.arguments.column) ?? 0,
        });
      default:
        return { error: "unknown tool" };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function collectCitations(result: unknown, into: LensRef[]): void {
  if (!result || typeof result !== "object") return;
  const obj = result as Record<string, unknown>;
  if (Array.isArray(obj.citations)) {
    for (const c of obj.citations) {
      if (c && typeof c === "object" && "kind" in c) into.push(c as LensRef);
    }
  }
}

function dedupeCitations(refs: LensRef[]): LensRef[] {
  const seen = new Set<string>();
  const out: LensRef[] = [];
  for (const r of refs) {
    const key = JSON.stringify(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
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

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export { testProviderConnection as testAgentConnection };
