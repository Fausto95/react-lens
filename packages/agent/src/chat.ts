import { TOOL_DEFINITIONS } from "./tools.js";
import { usesAnthropicApi } from "./providers.js";
import type { AgentSettings, ProviderTurn, ToolCall, ToolName } from "./types.js";

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

export type ProviderTranscript =
  | { kind: "openai"; messages: OpenAiMessage[] }
  | { kind: "anthropic"; system: string; messages: AnthropicMessage[] };

export function startTranscript(system: string, question: string, settings: AgentSettings): ProviderTranscript {
  if (usesAnthropicApi(settings.provider)) {
    return {
      kind: "anthropic",
      system,
      messages: [{ role: "user", content: question }],
    };
  }
  return {
    kind: "openai",
    messages: [
      { role: "system", content: system },
      { role: "user", content: question },
    ],
  };
}

export function appendAssistant(transcript: ProviderTranscript, turn: ProviderTurn): void {
  if (transcript.kind === "openai") {
    const raw = turn.rawAssistant as OpenAiMessage;
    transcript.messages.push(raw);
    return;
  }
  const raw = turn.rawAssistant as AnthropicMessage;
  transcript.messages.push(raw);
}

export function appendToolResults(
  transcript: ProviderTranscript,
  results: Array<{ id: string; name: string; content: string }>,
): void {
  if (transcript.kind === "openai") {
    for (const r of results) {
      transcript.messages.push({
        role: "tool",
        tool_call_id: r.id,
        name: r.name,
        content: r.content,
      });
    }
    return;
  }
  transcript.messages.push({
    role: "user",
    content: results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.id,
      content: r.content,
    })),
  });
}

export async function providerComplete(
  settings: AgentSettings,
  transcript: ProviderTranscript,
  signal?: AbortSignal,
): Promise<ProviderTurn> {
  if (usesAnthropicApi(settings.provider)) {
    if (transcript.kind !== "anthropic") throw new Error("transcript/provider mismatch");
    return anthropicComplete(settings, transcript, signal);
  }
  if (transcript.kind !== "openai") throw new Error("transcript/provider mismatch");
  return openAiComplete(settings, transcript, signal);
}

async function openAiComplete(
  settings: AgentSettings,
  transcript: Extract<ProviderTranscript, { kind: "openai" }>,
  signal?: AbortSignal,
): Promise<ProviderTurn> {
  const base = settings.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiKey.trim()) headers.authorization = `Bearer ${settings.apiKey}`;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      model: settings.model,
      messages: transcript.messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${truncate(body, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      message: {
        content?: string | null;
        tool_calls?: OpenAiMessage["tool_calls"];
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("Empty model response");

  const toolCalls = parseOpenAiTools(message.tool_calls);
  return {
    text: message.content ?? null,
    toolCalls,
    rawAssistant: {
      role: "assistant",
      content: message.content ?? null,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    } satisfies OpenAiMessage,
  };
}

async function anthropicComplete(
  settings: AgentSettings,
  transcript: Extract<ProviderTranscript, { kind: "anthropic" }>,
  signal?: AbortSignal,
): Promise<ProviderTurn> {
  const root = settings.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  const res = await fetch(`${root}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 4096,
      system: transcript.system,
      tools: TOOL_DEFINITIONS.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      })),
      messages: transcript.messages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude HTTP ${res.status}: ${truncate(body, 240)}`);
  }
  const data = (await res.json()) as {
    content?: AnthropicContent[];
  };
  const blocks = data.content ?? [];
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const b of blocks) {
    if (b.type === "text") textParts.push(b.text);
    if (b.type === "tool_use") {
      const name = b.name as ToolName;
      if (!TOOL_DEFINITIONS.some((t) => t.function.name === name)) continue;
      toolCalls.push({
        id: b.id,
        name,
        arguments: b.input ?? {},
      });
    }
  }
  return {
    text: textParts.join("\n").trim() || null,
    toolCalls,
    rawAssistant: { role: "assistant", content: blocks } satisfies AnthropicMessage,
  };
}

function parseOpenAiTools(raw: OpenAiMessage["tool_calls"]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const c of raw ?? []) {
    const name = c.function?.name as ToolName;
    if (!TOOL_DEFINITIONS.some((t) => t.function.name === name)) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    out.push({ id: c.id, name, arguments: args });
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export async function testProviderConnection(settings: AgentSettings): Promise<string> {
  if (usesAnthropicApi(settings.provider)) {
    if (!settings.apiKey.trim()) throw new Error("Missing API key");
    const root = settings.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    const res = await fetch(`${root}/v1/models`, {
      headers: {
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return settings.provider === "zml" ? "Z.AI connected" : "Claude connected";
  }

  const base = settings.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (settings.apiKey.trim()) headers.authorization = `Bearer ${settings.apiKey}`;
  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return "OpenAI connected";
}
