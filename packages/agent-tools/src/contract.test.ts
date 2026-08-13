import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import { createSourceResolver } from "@reactlens/source-maps";
import {
  TOOL_DEFINITIONS,
  TOOL_BUDGETS,
  TOOL_SCHEMA_VERSION,
  createToolHandlers,
  executeTool,
  enforceBudget,
  type ToolCall,
  type ToolName,
} from "./index.js";
import type {
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  RenderEvent,
  ComponentInstance,
} from "@reactlens/protocol";

function seedStore(): TraceStore {
  const store = new TraceStore();
  store.ingest({
    events: [
      {
        id: 1 as EventId,
        type: "interaction",
        timestamp: 1,
        interactionId: 1 as never,
        kind: "click",
      },
      {
        id: 2 as EventId,
        type: "render",
        timestamp: 2,
        renderId: 1 as RenderId,
        commitId: 1 as CommitId,
        componentId: 1 as ComponentId,
        interactionId: 1 as never,
        selfDuration: 5,
        totalDuration: 5,
        reasons: [{ type: "state", hookIndex: 0 }],
        compiler: { compiled: true, memoized: true },
      } satisfies RenderEvent,
    ],
    snapshots: [],
    instances: [
      {
        id: 1 as ComponentId,
        type: 1 as never,
        name: "App",
        rootId: 1 as never,
        compiler: { compiled: true, memoized: true },
        source: { file: "/src/App.tsx", line: 10, column: 0 },
      } satisfies ComponentInstance,
    ],
  });
  return store;
}

describe("agent-tools contracts", () => {
  it("every TOOL_DEFINITIONS entry has a budget and arg handler", () => {
    for (const def of TOOL_DEFINITIONS) {
      const name = def.function.name as ToolName;
      expect(TOOL_BUDGETS[name]).toBeGreaterThan(0);
    }
  });

  it("tool results include schemaVersion and unit suffixes", async () => {
    const store = seedStore();
    const handlers = createToolHandlers({
      store,
      causality: createCausality(store),
      sourceResolver: createSourceResolver(async () => {
        throw new Error("no fetch");
      }),
    });
    const summary = await handlers.get_session_summary({});
    expect(summary).toMatchObject({ schemaVersion: TOOL_SCHEMA_VERSION });
    const list = await handlers.list_interactions({});
    expect(list).toMatchObject({ schemaVersion: TOOL_SCHEMA_VERSION });
    if (!("error" in list)) {
      expect(list.interactions[0]).toHaveProperty("reactMs");
      expect(list.interactions[0]).toHaveProperty("durationMs");
    }
    const qt = await handlers.query_trace({});
    if (!("error" in qt)) {
      expect(qt.topRenders[0]).toHaveProperty("selfMs");
    }
  });

  it("enforceBudget returns summary+cursor instead of mid-JSON cut", () => {
    const huge = {
      schemaVersion: TOOL_SCHEMA_VERSION,
      citations: [],
      blob: "x".repeat(20_000),
    };
    const out = enforceBudget("query_trace", huge) as {
      truncated: boolean;
      cursor: string;
      budgetNote: string;
    };
    expect(out.truncated).toBe(true);
    expect(out.cursor).toBe("omit-details");
    expect(out.budgetNote).toMatch(/exceeded/);
    expect(JSON.stringify(out).length).toBeLessThan(TOOL_BUDGETS.query_trace);
  });

  it("executeTool validates required args", async () => {
    const store = seedStore();
    const handlers = createToolHandlers({
      store,
      causality: createCausality(store),
      sourceResolver: createSourceResolver(async () => {
        throw new Error("no fetch");
      }),
    });
    const call: ToolCall = { id: "1", name: "why", arguments: {} };
    const result = (await executeTool(handlers, call)) as { error: string };
    expect(result.error).toMatch(/missing required argument "renderId"/);
  });

  it("symptom tools return ranked verdicts with nextSteps", async () => {
    const store = seedStore();
    const handlers = createToolHandlers({
      store,
      causality: createCausality(store),
      sourceResolver: createSourceResolver(async () => {
        throw new Error("no fetch");
      }),
    });
    const slow = await handlers.diagnose_slowness({});
    expect(slow).toMatchObject({ schemaVersion: TOOL_SCHEMA_VERSION });
    if (!("error" in slow)) {
      expect(slow.verdict.length).toBeGreaterThan(0);
      expect(slow.nextSteps.length).toBeGreaterThan(0);
    }
  });
});
