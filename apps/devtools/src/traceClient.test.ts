import { describe, expect, it, vi, afterEach } from "vite-plus/test";
import type { CommitId, ComponentId, EventId, RenderEvent, RenderId } from "@reactlens/protocol";
import { createStore } from "jotai";
import { createTraceClient } from "./traceClient.js";
import { bindTraceVersion, traceVersionAtom } from "./atoms/trace.js";

let seq = 0;
function render(over: Partial<RenderEvent> = {}): RenderEvent {
  const n = ++seq;
  return {
    id: n as EventId,
    type: "render",
    timestamp: 10,
    renderId: n as RenderId,
    commitId: 1 as CommitId,
    componentId: 7 as ComponentId,
    selfDuration: 0.5,
    totalDuration: 1,
    reasons: [{ type: "mount" }],
    compiler: { compiled: true, memoized: true },
    ...over,
  };
}

function sampleBatch() {
  return {
    events: [render()],
    snapshots: [],
    instances: [
      {
        id: 7 as ComponentId,
        type: 1 as never,
        name: "Widget",
        rootId: 1 as never,
        compiler: { compiled: true, memoized: true },
      },
    ],
  };
}

describe("createTraceClient", () => {
  const handles: Array<{ dispose: () => void }> = [];
  afterEach(() => {
    for (const h of handles) h.dispose();
    handles.length = 0;
    vi.unstubAllGlobals();
  });

  it("exposes a sync mirror store and worker-authoritative ingest fallback", async () => {
    // happy-dom may lack a usable Worker — client must still work as fallback.
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("worker unavailable in test");
        }
      },
    );

    const handle = createTraceClient();
    handles.push(handle);
    expect(handle.client.workerAvailable).toBe(false);

    handle.client.ingest(sampleBatch());
    expect(handle.store.stats().components).toBe(1);
    expect(handle.store.instance(7 as ComponentId)?.name).toBe("Widget");
    expect(handle.store.timelineIndex.count).toBe(1);

    const stats = await handle.client.stats();
    expect(stats.events).toBe(1);
    expect(stats.components).toBe(1);
    const exported = await handle.client.export();
    expect(exported.instances).toHaveLength(1);
    handle.client.clear();
    expect(handle.store.stats().events).toBe(0);
  });

  it("bumps traceVersionAtom via bindTraceVersion", () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("worker unavailable in test");
        }
      },
    );
    const handle = createTraceClient();
    handles.push(handle);
    const jotai = createStore();
    const unbind = bindTraceVersion(handle.client, () => jotai.set(traceVersionAtom));
    expect(jotai.get(traceVersionAtom)).toBe(0);
    handle.client.ingest(sampleBatch());
    expect(jotai.get(traceVersionAtom)).toBe(1);
    unbind();
  });

  it("falls back exportSession / getCauses without a worker", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("worker unavailable in test");
        }
      },
    );
    const handle = createTraceClient();
    handles.push(handle);
    handle.client.ingest(sampleBatch());
    const session = await handle.client.exportSession({ title: "t" });
    expect(session.payload.instances).toHaveLength(1);
    expect(session.meta?.title).toBe("t");
    const renderId =
      session.payload.events[0]!.type === "render" ? session.payload.events[0]!.renderId : null;
    expect(renderId).not.toBeNull();
    const causes = await handle.client.getCauses(renderId!);
    expect(Array.isArray(causes)).toBe(true);
    expect(causes.length).toBeGreaterThan(0);
  });

  it("signals durable immediately when WAL requested without a worker", () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("worker unavailable in test");
        }
      },
    );
    const durable: number[] = [];
    const handle = createTraceClient({
      durableWal: true,
      wal: { onDurable: (_s, seqs) => durable.push(...seqs) },
    });
    handles.push(handle);
    handle.client.ingest(sampleBatch(), { sessionId: "s1", seq: 3 });
    expect(durable).toEqual([3]);
  });
});
