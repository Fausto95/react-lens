import { describe, it, expect, vi, afterEach } from "vitest";
import {
  startTranscript,
  appendAssistant,
  appendToolResults,
  providerComplete,
  providerCompleteStreaming,
  testProviderConnection,
  type ProviderTranscript,
} from "./chat.js";
import { defaultSettingsFor } from "./providers.js";
import type { AgentSettings } from "./types.js";

const openai: AgentSettings = { ...defaultSettingsFor("openai"), apiKey: "sk-test" };
const anthropic: AgentSettings = { ...defaultSettingsFor("anthropic"), apiKey: "ak-test" };

function mockFetchOnce(response: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of events) controller.enqueue(enc.encode(e));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request wire formats", () => {
  it("openai: posts chat/completions with bearer auth and tool schema", async () => {
    const fetchMock = mockFetchOnce(
      jsonResponse({ choices: [{ message: { content: "hi" } }] }),
    );
    const t = startTranscript("SYS", "Q", openai);
    await providerComplete(openai, t);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(openai.model);
    expect(body.tool_choice).toBe("auto");
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.tools[0].type).toBe("function");
  });

  it("anthropic: posts v1/messages with browser-access header and mapped tools", async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ content: [{ type: "text", text: "hi" }] }));
    const t = startTranscript("SYS", "Q", anthropic);
    await providerComplete(anthropic, t);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("ak-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    // Required for direct browser→Anthropic calls (the BYOK panel is a browser page).
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("SYS");
    expect(body.tools[0].input_schema).toBeDefined();
    expect(body.tools[0].type).toBeUndefined();
  });

  it("anthropic: strips a trailing /v1 from the base url", async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ content: [] }));
    const s = { ...anthropic, baseUrl: "https://gw.example.com/v1/" };
    await providerComplete(s, startTranscript("S", "Q", s));
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://gw.example.com/v1/messages");
  });

  it("test connection sends the browser-access header too", async () => {
    const fetchMock = mockFetchOnce(jsonResponse({ data: [] }));
    await testProviderConnection(anthropic);
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });
});

describe("tool call parsing", () => {
  it("openai: parses tool calls, tolerates malformed json args, drops unknown tools", async () => {
    mockFetchOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "a", type: "function", function: { name: "why", arguments: '{"renderId":4}' } },
                { id: "b", type: "function", function: { name: "why", arguments: "{broken" } },
                { id: "c", type: "function", function: { name: "made_up_tool", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    );
    const turn = await providerComplete(openai, startTranscript("S", "Q", openai));
    expect(turn.toolCalls).toHaveLength(2);
    expect(turn.toolCalls[0]).toMatchObject({ id: "a", name: "why", arguments: { renderId: 4 } });
    expect(turn.toolCalls[1]).toMatchObject({ id: "b", arguments: {} });
  });

  it("anthropic: parses tool_use blocks and keeps text alongside", async () => {
    mockFetchOnce(
      jsonResponse({
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "t1", name: "why", input: { renderId: 9 } },
        ],
      }),
    );
    const turn = await providerComplete(anthropic, startTranscript("S", "Q", anthropic));
    expect(turn.text).toBe("Let me check.");
    expect(turn.toolCalls[0]).toMatchObject({ id: "t1", name: "why", arguments: { renderId: 9 } });
  });
});

describe("transcript round-trips", () => {
  it("appends assistant turns and tool results in each wire format", () => {
    const to: ProviderTranscript = startTranscript("S", "Q", openai);
    appendAssistant(to, {
      text: null,
      toolCalls: [],
      rawAssistant: { role: "assistant", content: null },
    });
    appendToolResults(to, [{ id: "x", name: "why", content: "{}" }]);
    expect(to.kind === "openai" && to.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "x",
    });

    const ta: ProviderTranscript = startTranscript("S", "Q", anthropic);
    appendAssistant(ta, {
      text: "t",
      toolCalls: [],
      rawAssistant: { role: "assistant", content: [{ type: "text", text: "t" }] },
    });
    appendToolResults(ta, [{ id: "x", name: "why", content: "{}" }]);
    const last = ta.kind === "anthropic" ? ta.messages.at(-1) : undefined;
    expect(last?.role).toBe("user");
    expect((last?.content as Array<{ type: string }>)[0]?.type).toBe("tool_result");
  });
});

describe("streaming", () => {
  it("openai: emits text deltas and accumulates streamed tool call arguments", async () => {
    const chunk = (delta: unknown) =>
      `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
    mockFetchOnce(
      sseResponse([
        chunk({ content: "Hel" }),
        chunk({ content: "lo" }),
        chunk({ tool_calls: [{ index: 0, id: "t1", function: { name: "why", arguments: '{"ren' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'derId":4}' } }] }),
        "data: [DONE]\n\n",
      ]),
    );
    const deltas: string[] = [];
    const turn = await providerCompleteStreaming(
      openai,
      startTranscript("S", "Q", openai),
      (text) => deltas.push(text),
    );
    expect(deltas.join("")).toBe("Hello");
    expect(turn.text).toBe("Hello");
    expect(turn.toolCalls[0]).toMatchObject({ id: "t1", name: "why", arguments: { renderId: 4 } });
  });

  it("anthropic: emits text deltas and accumulates input_json_delta", async () => {
    const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    mockFetchOnce(
      sseResponse([
        ev("message_start", { message: {} }),
        ev("content_block_start", { index: 0, content_block: { type: "text" } }),
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hi " } }),
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "there" } }),
        ev("content_block_stop", { index: 0 }),
        ev("content_block_start", { index: 1, content_block: { type: "tool_use", id: "t9", name: "why" } }),
        ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"render' } }),
        ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: 'Id":7}' } }),
        ev("content_block_stop", { index: 1 }),
        ev("message_stop", {}),
      ]),
    );
    const deltas: string[] = [];
    const turn = await providerCompleteStreaming(
      anthropic,
      startTranscript("S", "Q", anthropic),
      (text) => deltas.push(text),
    );
    expect(deltas.join("")).toBe("Hi there");
    expect(turn.text).toBe("Hi there");
    expect(turn.toolCalls[0]).toMatchObject({ id: "t9", name: "why", arguments: { renderId: 7 } });
  });

  it("falls back to buffered parsing when the response is not SSE", async () => {
    mockFetchOnce(jsonResponse({ choices: [{ message: { content: "plain" } }] }));
    const turn = await providerCompleteStreaming(openai, startTranscript("S", "Q", openai), () => {});
    expect(turn.text).toBe("plain");
  });
});
