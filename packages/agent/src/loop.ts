import type { LensRef } from "@reactlens/explain";
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
  ToolName,
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

/**
 * Declarative argument contracts per tool. Validation is strict: a missing or
 * mistyped required argument becomes a recoverable error naming the field,
 * never a silent fallback the model would mistake for a real id.
 */
type FieldSpec = { type: "string" | "number"; required?: boolean; enum?: readonly string[] };
const TOOL_ARG_SPECS: Record<ToolName, Record<string, FieldSpec>> = {
  explain_interaction: { interactionId: { type: "string" } },
  query_trace: { interactionId: { type: "string" }, limit: { type: "number" } },
  why: { renderId: { type: "number", required: true } },
  diff_snapshots: {
    kind: { type: "string", required: true, enum: ["props", "dom", "state", "hooks", "context"] },
    beforeRenderId: { type: "number", required: true },
    afterRenderId: { type: "number", required: true },
  },
  diagnose: { componentId: { type: "number", required: true } },
  resolve_source: {
    file: { type: "string", required: true },
    line: { type: "number", required: true },
    column: { type: "number", required: true },
  },
  find_component: { name: { type: "string", required: true } },
  component_renders: { componentId: { type: "number", required: true }, limit: { type: "number" } },
  component_runtime: { componentId: { type: "number", required: true } },
  read_component_source: {
    componentId: { type: "number", required: true },
    contextLines: { type: "number" },
  },
  effects_summary: { componentId: { type: "number", required: true } },
  graph_neighbors: { componentId: { type: "number", required: true } },
};

function parseToolArgs(
  call: ToolCall,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const spec = TOOL_ARG_SPECS[call.name];
  if (!spec) return { ok: false, error: `unknown tool ${call.name}` };
  const out: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(spec)) {
    const raw = call.arguments[field];
    // Models often stringify numbers — coerce rather than reject.
    const value =
      rule.type === "number" && typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))
        ? Number(raw)
        : raw;
    if (value === undefined || value === null) {
      if (rule.required) {
        return { ok: false, error: `${call.name}: missing required argument "${field}"` };
      }
      continue;
    }
    if (typeof value !== rule.type) {
      return { ok: false, error: `${call.name}: argument "${field}" must be a ${rule.type}` };
    }
    if (rule.enum && !rule.enum.includes(value as string)) {
      return { ok: false, error: `${call.name}: "${field}" must be one of ${rule.enum.join(", ")}` };
    }
    out[field] = value;
  }
  return { ok: true, args: out };
}

export async function executeTool(handlers: ToolHandlers, call: ToolCall): Promise<unknown> {
  const parsed = parseToolArgs(call);
  if (!parsed.ok) return { error: parsed.error };
  try {
    const handler = handlers[call.name] as (args: Record<string, unknown>) => unknown;
    return await handler(parsed.args);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function collectCitations(result: unknown, into: LensRef[]): void {
  if (!result || typeof result !== "object") return;
  const obj = result as Record<string, unknown>;
  if (Array.isArray(obj.citations)) {
    for (const c of obj.citations) {
      if (c && typeof c === "object" && "kind" in c) into.push(c as LensRef);
    }
  }
}

export function dedupeCitations(refs: LensRef[]): LensRef[] {
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

export { testProviderConnection as testAgentConnection };
