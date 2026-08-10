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

/**
 * Streaming variant: same normalized ProviderTurn, but `onDelta` fires with
 * each text fragment as it arrives. Falls back to buffered parsing when the
 * endpoint doesn't answer with SSE (some OpenAI-compatible gateways).
 */
export async function providerCompleteStreaming(
  settings: AgentSettings,
  transcript: ProviderTranscript,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<ProviderTurn> {
  if (usesAnthropicApi(settings.provider)) {
    if (transcript.kind !== "anthropic") throw new Error("transcript/provider mismatch");
    return anthropicStream(settings, transcript, onDelta, signal);
  }
  if (transcript.kind !== "openai") throw new Error("transcript/provider mismatch");
  return openAiStream(settings, transcript, onDelta, signal);
}

function anthropicHeaders(settings: AgentSettings): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": settings.apiKey,
    "anthropic-version": "2023-06-01",
    // The panel is a browser page calling the API directly (BYOK); without
    // this opt-in header Anthropic rejects the CORS preflight.
    "anthropic-dangerous-direct-browser-access": "true",
  };
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
    headers: anthropicHeaders(settings),
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

// ── SSE streaming ────────────────────────────────────────────────────────────

function isEventStream(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("text/event-stream");
}

/** Yield the `data:` payload of each SSE event in the response body. */
async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of event.split("\n")) {
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  }
}

async function openAiStream(
  settings: AgentSettings,
  transcript: Extract<ProviderTranscript, { kind: "openai" }>,
  onDelta: (text: string) => void,
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
      stream: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${truncate(body, 240)}`);
  }
  if (!isEventStream(res)) {
    // Gateway ignored stream:true — parse the buffered completion instead.
    const data = (await res.json()) as {
      choices?: Array<{ message: { content?: string | null; tool_calls?: OpenAiMessage["tool_calls"] } }>;
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Empty model response");
    if (message.content) onDelta(message.content);
    return {
      text: message.content ?? null,
      toolCalls: parseOpenAiTools(message.tool_calls),
      rawAssistant: {
        role: "assistant",
        content: message.content ?? null,
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      } satisfies OpenAiMessage,
    };
  }

  let text = "";
  const partials = new Map<number, { id: string; name: string; args: string }>();
  for await (const data of sseData(res)) {
    if (data === "[DONE]") break;
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      text += delta.content;
      onDelta(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const slot = partials.get(tc.index) ?? { id: "", name: "", args: "" };
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
      partials.set(tc.index, slot);
    }
  }

  const rawToolCalls = [...partials.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, p]) => ({ id: p.id, type: "function" as const, function: { name: p.name, arguments: p.args } }));
  return {
    text: text || null,
    toolCalls: parseOpenAiTools(rawToolCalls),
    rawAssistant: {
      role: "assistant",
      content: text || null,
      ...(rawToolCalls.length > 0 ? { tool_calls: rawToolCalls } : {}),
    } satisfies OpenAiMessage,
  };
}

async function anthropicStream(
  settings: AgentSettings,
  transcript: Extract<ProviderTranscript, { kind: "anthropic" }>,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<ProviderTurn> {
  const root = settings.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  const res = await fetch(`${root}/v1/messages`, {
    method: "POST",
    signal,
    headers: anthropicHeaders(settings),
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
      stream: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude HTTP ${res.status}: ${truncate(body, 240)}`);
  }
  if (!isEventStream(res)) {
    const data = (await res.json()) as { content?: AnthropicContent[] };
    return parseAnthropicBlocks(data.content ?? [], onDelta);
  }

  // Reassemble content blocks by index from the event stream.
  const blocks = new Map<number, { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; json: string }>();
  for await (const data of sseData(res)) {
    let event: {
      type?: string;
      index?: number;
      content_block?: { type: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
    };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event.type === "content_block_start" && event.index !== undefined && event.content_block) {
      const cb = event.content_block;
      blocks.set(
        event.index,
        cb.type === "tool_use"
          ? { type: "tool_use", id: cb.id ?? "", name: cb.name ?? "", json: "" }
          : { type: "text", text: "" },
      );
    } else if (event.type === "content_block_delta" && event.index !== undefined && event.delta) {
      const block = blocks.get(event.index);
      if (!block) continue;
      if (block.type === "text" && event.delta.type === "text_delta" && event.delta.text) {
        block.text += event.delta.text;
        onDelta(event.delta.text);
      }
      if (block.type === "tool_use" && event.delta.type === "input_json_delta" && event.delta.partial_json) {
        block.json += event.delta.partial_json;
      }
    } else if (event.type === "message_stop") {
      break;
    }
  }

  const content: AnthropicContent[] = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, b]) =>
      b.type === "text"
        ? { type: "text" as const, text: b.text }
        : { type: "tool_use" as const, id: b.id, name: b.name, input: safeJson(b.json) },
    );
  return parseAnthropicBlocks(content, null);
}

/** Normalize Anthropic content blocks into a ProviderTurn (shared by both paths). */
function parseAnthropicBlocks(
  blocks: AnthropicContent[],
  onDelta: ((text: string) => void) | null,
): ProviderTurn {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      textParts.push(b.text);
      onDelta?.(b.text);
    }
    if (b.type === "tool_use") {
      const name = b.name as ToolName;
      if (!TOOL_DEFINITIONS.some((t) => t.function.name === name)) continue;
      toolCalls.push({ id: b.id, name, arguments: b.input ?? {} });
    }
  }
  return {
    text: textParts.join("\n").trim() || null,
    toolCalls,
    rawAssistant: { role: "assistant", content: blocks } satisfies AnthropicMessage,
  };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function testProviderConnection(settings: AgentSettings): Promise<string> {
  if (usesAnthropicApi(settings.provider)) {
    if (!settings.apiKey.trim()) throw new Error("Missing API key");
    const root = settings.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    const res = await fetch(`${root}/v1/models`, { headers: anthropicHeaders(settings) });
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
