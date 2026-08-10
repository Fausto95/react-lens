import { describe, it, expect, vi, afterEach } from "vitest";
import { createAgentSession } from "./session.js";
import { budgetToolResult } from "./budget.js";
import { defaultSettingsFor } from "./providers.js";
import type { AgentEvent, ToolHandlers } from "./types.js";
import type { EvidencePack } from "./evidence.js";

const settings = { ...defaultSettingsFor("openai"), apiKey: "sk-test" };

/** Scripted fake provider: each entry is one buffered OpenAI response body. */
function scriptProvider(bodies: unknown[]): ReturnType<typeof vi.fn> {
  const queue = [...bodies];
  const fn = vi.fn(async () => {
    const body = queue.shift() ?? { choices: [{ message: { content: "fallback" } }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const textTurn = (content: string) => ({ choices: [{ message: { content } }] });
const toolTurn = (name: string, args: object, id = "t1") => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
      },
    },
  ],
});

function stubHandlers(overrides: Partial<ToolHandlers> = {}): ToolHandlers {
  const err = { error: "not stubbed" };
  return {
    explain_interaction: () => err,
    query_trace: () => err,
    why: () => err,
    diff_snapshots: () => err,
    diagnose: () => err,
    resolve_source: () => err,
    find_component: () => err,
    component_renders: () => err,
    read_component_source: () => err,
    effects_summary: () => err,
    graph_neighbors: () => err,
    ...overrides,
  } as ToolHandlers;
}

const emptyEvidence: EvidencePack = {
  stats: { events: 1, renders: 1, snapshots: 0, components: 1 },
  interactions: [{ id: "i1", label: "Click App", kind: "click", durationMs: 12, renderCount: 1 }],
  topComponents: [{ componentId: 1, name: "App", renders: 1, totalSelf: 3 }],
  commitAnomalies: { median: 1, p95: 1, anomalies: [] },
  reactCompiler: { compiledComponents: 1, totalComponents: 1 },
};

afterEach(() => vi.unstubAllGlobals());

describe("budgetToolResult", () => {
  it("passes small results through and truncates large ones with a note", () => {
    expect(budgetToolResult("short", 100)).toEqual({ content: "short", truncated: false });
    const big = "x".repeat(500);
    const out = budgetToolResult(big, 100);
    expect(out.truncated).toBe(true);
    expect(out.content.length).toBeLessThan(300);
    expect(out.content).toMatch(/truncated/);
  });
});

describe("agent session", () => {
  it("keeps conversation state across sends and prepends evidence once", async () => {
    const fetchMock = scriptProvider([textTurn("Answer one."), textTurn("Answer two.")]);
    const session = createAgentSession({ settings, handlers: stubHandlers(), evidence: emptyEvidence });

    const a1 = await session.send("Why slow?");
    expect(a1.text).toBe("Answer one.");
    const a2 = await session.send("And the fix?");
    expect(a2.text).toBe("Answer two.");

    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

    // The second request carries the whole prior conversation.
    const secondBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    const contents = secondBody.messages.map((m: { content: unknown }) => String(m.content));
    expect(contents.some((c: string) => c.includes("SESSION EVIDENCE"))).toBe(true);
    expect(contents.some((c: string) => c.includes("Why slow?"))).toBe(true);
    expect(contents.some((c: string) => c.includes("Answer one."))).toBe(true);
    expect(contents.some((c: string) => c.includes("And the fix?"))).toBe(true);
    // Evidence appears exactly once (first turn only).
    expect(contents.filter((c: string) => c.includes("SESSION EVIDENCE"))).toHaveLength(1);
  });

  it("dispatches tools, budgets what the model sees, and emits events", async () => {
    const bigResult = { componentId: 1, blob: "y".repeat(20_000), citations: [] };
    const fetchMock = scriptProvider([
      toolTurn("diagnose", { componentId: 1 }),
      textTurn("Diagnosed."),
    ]);
    const events: AgentEvent[] = [];
    const session = createAgentSession({
      settings,
      handlers: stubHandlers({ diagnose: () => bigResult as never }),
    });
    const answer = await session.send("check App", { onEvent: (e) => events.push(e) });

    expect(answer.text).toBe("Diagnosed.");
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("model_start");
    expect(types).toContain("tool_start");
    expect(types).toContain("tool_result");
    expect(types.at(-1)).toBe("done");

    // The tool message the MODEL receives is budgeted, with a note.
    const secondBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.content.length).toBeLessThan(8_000);
    expect(toolMsg.content).toMatch(/truncated/);
  });

  it("rejects invalid tool args with a recovery message instead of id 0", async () => {
    const seen: string[] = [];
    scriptProvider([toolTurn("why", {}), textTurn("ok")]);
    const session = createAgentSession({ settings, handlers: stubHandlers() });
    await session.send("q", {
      onEvent: (e) => {
        if (e.type === "tool_result") seen.push(e.summary);
      },
    });
    expect(seen[0]).toMatch(/missing required argument "renderId"/);
  });

  it("stops at the step ceiling with an explicit message", async () => {
    scriptProvider(Array.from({ length: 20 }, () => toolTurn("diagnose", { componentId: 1 })));
    const session = createAgentSession({
      settings,
      handlers: stubHandlers({ diagnose: () => ({ ok: true }) as never }),
    });
    const answer = await session.send("loop forever");
    expect(answer.text).toMatch(/max tool steps/i);
  });

  it("aborts cleanly and stays usable for the next send", async () => {
    const controller = new AbortController();
    const fn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      controller.abort();
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fn);
    const session = createAgentSession({ settings, handlers: stubHandlers() });
    const answer = await session.send("q", { signal: controller.signal });
    expect(answer.text).toMatch(/stopped/i);

    scriptProvider([textTurn("recovered")]);
    const next = await session.send("again");
    expect(next.text).toBe("recovered");
  });
});
