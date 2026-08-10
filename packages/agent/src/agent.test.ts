import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS, SYSTEM_PROMPT } from "./tools.js";
import { createToolHandlers } from "./handlers.js";
import { TraceStore } from "@react-lens/trace-engine";
import { createCausality } from "@react-lens/causality";
import { createSourceResolver } from "@react-lens/source-maps";
import type {
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  RenderEvent,
  ComponentInstance,
} from "@react-lens/protocol";

describe("agent tools", () => {
  it("exposes a closed tool set", () => {
    expect(SYSTEM_PROMPT).toMatch(/Lens ID/);
    expect(TOOL_DEFINITIONS.map((t) => t.function.name)).toEqual([
      "explain_interaction",
      "query_trace",
      "why",
      "find_component",
      "component_renders",
      "read_component_source",
      "effects_summary",
      "graph_neighbors",
      "diff_snapshots",
      "diagnose",
      "resolve_source",
    ]);
  });

  it("query_trace returns stats from the live store", () => {
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
          selfDuration: 3,
          totalDuration: 3,
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
    const out = handlers.query_trace({}) as {
      stats: { renders: number };
      topRenders: Array<{ name: string }>;
    };
    expect(out.stats.renders).toBeGreaterThanOrEqual(1);
    expect(out.topRenders[0]?.name).toBe("App");
  });

  it("exposes OpenAI, Claude, and ZML presets", async () => {
    const { PROVIDER_PRESETS, normalizeProvider } = await import("./providers.js");
    expect(Object.keys(PROVIDER_PRESETS)).toEqual(["openai", "anthropic", "zml"]);
    expect(normalizeProvider("claude")).toBe("anthropic");
    expect(normalizeProvider("zlm")).toBe("zml");
    expect(PROVIDER_PRESETS.zml.baseUrl).toBe("https://api.z.ai/api/anthropic");
    expect(PROVIDER_PRESETS.zml.model).toBe("glm-5v-turbo");
    expect(PROVIDER_PRESETS.zml.api).toBe("anthropic");
  });
});
