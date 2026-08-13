import type { LensRef } from "@reactlens/explain";
import {
  executeTool,
  collectCitations,
  dedupeCitations,
  budgetToolResult,
  capFor,
  formatEvidencePack,
  type EvidencePack,
  type ToolHandlers,
} from "@reactlens/agent-tools";
import { SYSTEM_PROMPT } from "./prompt.js";
import {
  appendAssistant,
  appendToolResults,
  appendUser,
  providerCompleteStreaming,
  startTranscript,
  type ProviderTranscript,
} from "./chat.js";
import { PROVIDER_PRESETS } from "./providers.js";
import type {
  AgentAnswer,
  AgentEvent,
  AgentSession,
  AgentSettings,
  AgentStep,
  ChatMessage,
} from "./types.js";

const MAX_STEPS = 12;

/**
 * Multi-turn conversation over the closed tool set. The session owns the
 * provider transcript; each send() streams the model, executes tool calls
 * with budgeted results, and appends to the shared history. Recreate the
 * session when settings or the trace store change.
 */
export function createAgentSession(opts: {
  settings: AgentSettings;
  handlers: ToolHandlers;
  evidence?: EvidencePack;
}): AgentSession {
  const { settings, handlers, evidence } = opts;
  const messages: ChatMessage[] = [];
  let transcript: ProviderTranscript | null = null;
  let toolCharsSpent = 0;

  async function send(
    question: string,
    sendOpts?: { signal?: AbortSignal; onEvent?: (e: AgentEvent) => void },
  ): Promise<AgentAnswer> {
    const { signal, onEvent } = sendOpts ?? {};
    const preset = PROVIDER_PRESETS[settings.provider];
    if (preset.keyRequired && !settings.apiKey.trim()) {
      throw new Error(`Missing API key for ${preset.label} — add one in Settings (BYOK).`);
    }

    if (!transcript) {
      const first = evidence ? `${formatEvidencePack(evidence)}\n\n${question}` : question;
      transcript = startTranscript(SYSTEM_PROMPT, first, settings);
    } else {
      appendUser(transcript, question);
    }
    messages.push({ role: "user", content: question });

    const steps: AgentStep[] = [];
    const citations: LensRef[] = [];

    const finish = (text: string): AgentAnswer => {
      const answer: AgentAnswer = { text, citations: dedupeCitations(citations), steps };
      messages.push({ role: "assistant", content: text, citations: answer.citations, steps });
      onEvent?.({ type: "done", answer });
      return answer;
    };

    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        if (signal?.aborted) return finish("Stopped.");
        onEvent?.({ type: "model_start" });
        const turn = await providerCompleteStreaming(
          settings,
          transcript,
          (text) => onEvent?.({ type: "text_delta", text }),
          signal,
        );
        appendAssistant(transcript, turn);

        if (turn.toolCalls.length === 0) {
          const text = turn.text?.trim() || "No answer.";
          steps.push({ role: "assistant", content: text });
          return finish(text);
        }

        const toolResults: Array<{ id: string; name: string; content: string }> = [];
        for (const call of turn.toolCalls) {
          const result = signal?.aborted
            ? { error: "aborted by user" }
            : (onEvent?.({ type: "tool_start", name: call.name, args: call.arguments }),
              await executeTool(handlers, call));
          collectCitations(result, citations);
          const budgeted = budgetToolResult(safeJson(result), capFor(call.name, toolCharsSpent));
          toolCharsSpent += budgeted.content.length;
          steps.push({ role: "tool", name: call.name, content: budgeted.content });
          onEvent?.({
            type: "tool_result",
            name: call.name,
            summary: budgeted.content,
            citations: ownCitations(result),
          });
          toolResults.push({ id: call.id, name: call.name, content: budgeted.content });
        }
        appendToolResults(transcript, toolResults);
        if (signal?.aborted) return finish("Stopped.");
      }
      return finish("Stopped after max tool steps. Ask a narrower question to continue.");
    } catch (err) {
      if (isAbort(err)) return finish("Stopped.");
      onEvent?.({ type: "error", message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  return { send, messages };
}

function ownCitations(result: unknown): LensRef[] {
  const refs: LensRef[] = [];
  collectCitations(result, refs);
  return refs;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "unserializable" });
  }
}
