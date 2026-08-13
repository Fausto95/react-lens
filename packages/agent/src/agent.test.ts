import { describe, it, expect } from "vite-plus/test";
import { TOOL_DEFINITIONS, SYSTEM_PROMPT } from "./index.js";
import { createToolHandlers } from "@reactlens/agent-tools";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import { createSourceResolver } from "@reactlens/source-maps";
import type {
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  RenderEvent,
  ComponentInstance,
} from "@reactlens/protocol";

describe("agent tools", () => {
  it("commits to the five questions, citations, compiler invariant, and fix format", () => {
    expect(SYSTEM_PROMPT).toMatch(/why did it render/i);
    expect(SYSTEM_PROMPT).toMatch(/how do i fix it/i);
    expect(SYSTEM_PROMPT).toContain("[component:");
    expect(SYSTEM_PROMPT).toContain("[render:");
    expect(SYSTEM_PROMPT).toMatch(/React Compiler/);
    expect(SYSTEM_PROMPT).toMatch(/useMemo/);
    expect(SYSTEM_PROMPT).toMatch(/read_component_source/);
    expect(SYSTEM_PROMPT).toMatch(/file:line|src\/File\.tsx:42/);
  });

  it("exposes a closed tool set including symptom tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "explain_interaction",
        "query_trace",
        "why",
        "find_component",
        "list_interactions",
        "get_session_summary",
        "get_waste_report",
        "diagnose_slowness",
      ]),
    );
  });

  it("query_trace returns stats from the live store", async () => {
    const store = new TraceStore();
    store.ingest({
      events: [
        {
          id: 1 as EventId,
          type: "render",
          timestamp: 1,
          renderId: 1 as RenderId,
          commitId: 1 as CommitId,
          componentId: 1 as ComponentId,
          selfDuration: 2,
          totalDuration: 2,
          reasons: [{ type: "mount" }],
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
        } satisfies ComponentInstance,
      ],
    });
    const handlers = createToolHandlers({
      store,
      causality: createCausality(store),
      diagnose: () => [],
      sourceResolver: createSourceResolver(async () => {
        throw new Error("no fetch");
      }),
    });
    const out = (await handlers.query_trace({})) as {
      stats: { renders: number };
      topRenders: Array<{ selfMs: number }>;
    };
    expect(out.stats.renders).toBe(1);
    expect(out.topRenders[0]?.selfMs).toBe(2);
  });
});
