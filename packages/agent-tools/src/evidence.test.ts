import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import { createSourceResolver } from "@reactlens/source-maps";
import { buildEvidencePack, formatEvidencePack } from "./evidence.js";
import { createToolHandlers } from "./handlers.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import type {
  RenderEvent,
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  ComponentInstance,
  EventsBatchMessage,
} from "@reactlens/protocol";

let seq = 0;
const cid = (n: number) => n as ComponentId;

function renderEvent(over: Partial<RenderEvent> = {}): RenderEvent {
  seq++;
  return {
    id: seq as EventId,
    type: "render",
    timestamp: seq * 100,
    renderId: seq as RenderId,
    commitId: seq as CommitId,
    componentId: cid(1),
    selfDuration: 1,
    totalDuration: 1,
    reasons: [{ type: "mount" }],
    compiler: { compiled: true, memoized: true },
    ...over,
  };
}

function instance(id: number, name: string, compiled = true): ComponentInstance {
  return {
    id: cid(id),
    type: id as never,
    name,
    rootId: 1 as never,
    compiler: { compiled, memoized: compiled },
  };
}

function batch(over: Partial<EventsBatchMessage["payload"]> = {}): EventsBatchMessage["payload"] {
  return { events: [], snapshots: [], instances: [], ...over };
}

describe("evidence pack", () => {
  it("summarizes stats, interactions, top components, anomalies and compiler coverage", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "App"), instance(2, "BigList", false)],
        events: [
          renderEvent({ componentId: cid(1), selfDuration: 2 }),
          renderEvent({ componentId: cid(2), selfDuration: 40 }),
          renderEvent({ componentId: cid(2), selfDuration: 3 }),
        ],
      }),
    );
    const pack = buildEvidencePack(store);
    expect(pack.stats.renders).toBe(3);
    expect(pack.interactions.length).toBeGreaterThanOrEqual(1);
    expect(pack.topComponents[0]).toMatchObject({ name: "BigList", renders: 2 });
    expect(pack.commitAnomalies.p95).toBeGreaterThan(0);
    expect(pack.reactCompiler).toEqual({ compiledComponents: 1, totalComponents: 2 });
  });

  it("formats as a compact fenced block the loop can prepend", () => {
    const store = new TraceStore();
    store.ingest(batch({ instances: [instance(1, "App")], events: [renderEvent()] }));
    const text = formatEvidencePack(buildEvidencePack(store));
    expect(text).toMatch(/SESSION EVIDENCE/);
    expect(text).toMatch(/App/);
    expect(text.length).toBeLessThan(4000);
  });

  it("says so when the session is empty", () => {
    const text = formatEvidencePack(buildEvidencePack(new TraceStore()));
    expect(text).toMatch(/no renders recorded/i);
  });
});

describe("tool surface", () => {
  it("tool definitions and handlers expose the same closed set", () => {
    const store = new TraceStore();
    const handlers = createToolHandlers({
      store,
      causality: createCausality(store),
      diagnose: () => [],
      sourceResolver: createSourceResolver(async () => {
        throw new Error("no fetch");
      }),
    });
    const defined = TOOL_DEFINITIONS.map((t) => t.function.name).sort();
    expect(Object.keys(handlers).sort()).toEqual(defined);
  });
});
