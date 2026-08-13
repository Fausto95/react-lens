import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import { createSourceResolver } from "@reactlens/source-maps";
import { createToolHandlers } from "@reactlens/agent-tools";
import type {
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  RenderEvent,
  InteractionEvent,
  InteractionId,
} from "@reactlens/protocol";

function wastedSessionHandlers() {
  const store = new TraceStore();
  store.ingest({
    events: [
      {
        id: 1 as EventId,
        type: "interaction",
        timestamp: 1,
        interactionId: 1 as InteractionId,
        kind: "click",
        name: "toggle",
      } satisfies InteractionEvent,
      {
        id: 2 as EventId,
        type: "render",
        timestamp: 2,
        renderId: 1 as RenderId,
        commitId: 1 as CommitId,
        componentId: 1 as ComponentId,
        interactionId: 1 as InteractionId,
        selfDuration: 4,
        totalDuration: 4,
        reasons: [{ type: "props", changed: ["x"] }],
        compiler: { compiled: true, memoized: true },
      } satisfies RenderEvent,
      {
        id: 3 as EventId,
        type: "render",
        timestamp: 3,
        renderId: 2 as RenderId,
        commitId: 1 as CommitId,
        componentId: 1 as ComponentId,
        interactionId: 1 as InteractionId,
        selfDuration: 3,
        totalDuration: 3,
        reasons: [{ type: "parent", componentId: 2 as ComponentId }],
        compiler: { compiled: true, memoized: true },
      } satisfies RenderEvent,
    ],
    snapshots: [],
    instances: [
      {
        id: 1 as ComponentId,
        type: 1 as never,
        name: "Leaf",
        rootId: 1 as never,
        compiler: { compiled: true, memoized: true },
      },
    ],
  });
  return createToolHandlers({
    store,
    causality: createCausality(store),
    sourceResolver: createSourceResolver(async () => {
      throw new Error("no fetch");
    }),
  });
}

describe("mcp contract (handlers)", () => {
  it("get_waste_report and diagnose_slowness work on a wasted-render session", async () => {
    const handlers = wastedSessionHandlers();
    const waste = await handlers.get_waste_report({ limit: 5 });
    expect(waste).toMatchObject({ schemaVersion: 1 });
    const slow = await handlers.diagnose_slowness({});
    expect(slow).toMatchObject({ schemaVersion: 1 });
    if (!("error" in slow)) {
      expect(slow.citations.length).toBeGreaterThan(0);
    }
  });
});
