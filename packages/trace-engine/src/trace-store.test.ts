import { describe, it, expect, vi } from "vitest";
import { TraceStore } from "./trace-store.js";
import { RingBuffer } from "./ring-buffer.js";
import type {
  RenderEvent,
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  InteractionId,
  ComponentInstance,
  RenderSnapshot,
  EventsBatchMessage,
} from "@react-lens/protocol";

let eventSeq = 0;
function renderEvent(over: Partial<RenderEvent> = {}): RenderEvent {
  return {
    id: (++eventSeq) as EventId,
    type: "render",
    timestamp: eventSeq,
    renderId: (eventSeq) as RenderId,
    commitId: (1) as CommitId,
    componentId: (1) as ComponentId,
    selfDuration: 1,
    totalDuration: 1,
    reasons: [{ type: "parent", componentId: (2) as ComponentId }],
    compiler: { compiled: true, memoized: true },
    ...over,
  };
}

function instance(id: number, name: string): ComponentInstance {
  return {
    id: id as ComponentId,
    type: id as never,
    name,
    rootId: 1 as never,
    compiler: { compiled: true, memoized: true },
  };
}

function batch(over: Partial<EventsBatchMessage["payload"]> = {}): EventsBatchMessage["payload"] {
  return { events: [], snapshots: [], instances: [], ...over };
}

describe("RingBuffer", () => {
  it("keeps only the most recent items, oldest→newest", () => {
    const rb = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => rb.push(n));
    expect(rb.toArray()).toEqual([3, 4, 5]);
    expect(rb.size).toBe(3);
  });

  it("rejects non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});

describe("TraceStore — ingestion & queries", () => {
  it("records renders per component up to the cap", () => {
    const store = new TraceStore({ maxRendersPerComponent: 3 });
    const events = [1, 2, 3, 4, 5].map((n) =>
      renderEvent({ componentId: 7 as ComponentId, renderId: n as RenderId }),
    );
    store.ingest(batch({ events }));
    const renders = store.rendersOf(7 as ComponentId);
    expect(renders).toHaveLength(3);
    expect(renders.map((r) => r.renderId)).toEqual([3, 4, 5]);
  });

  it("stores and retrieves instances", () => {
    const store = new TraceStore();
    store.ingest(batch({ instances: [instance(9, "ProductCard")] }));
    expect(store.instance(9 as ComponentId)?.name).toBe("ProductCard");
  });

  it("groups events by interaction", () => {
    const store = new TraceStore();
    const i = 42 as InteractionId;
    store.ingest(
      batch({
        events: [
          renderEvent({ interactionId: i, componentId: 1 as ComponentId }),
          renderEvent({ interactionId: i, componentId: 2 as ComponentId }),
        ],
      }),
    );
    expect(store.eventsByInteraction(i)).toHaveLength(2);
  });

  it("retrieves snapshots by renderId and bounds them", () => {
    const store = new TraceStore({ maxSnapshots: 2 });
    const snap = (id: number): RenderSnapshot => ({
      renderId: id as RenderId,
      componentId: 1 as ComponentId,
      timestamp: id,
      props: { k: "undefined" },
    });
    store.ingest(batch({ snapshots: [snap(1), snap(2), snap(3)] }));
    expect(store.snapshot(1 as RenderId)).toBeUndefined(); // evicted
    expect(store.snapshot(3 as RenderId)).toBeDefined();
  });

  it("reports stats", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        events: [renderEvent({ componentId: 1 as ComponentId })],
        instances: [instance(1, "A")],
      }),
    );
    const stats = store.stats();
    expect(stats.events).toBe(1);
    expect(stats.renders).toBe(1);
    expect(stats.components).toBe(1);
  });
});

describe("TraceStore — commits", () => {
  it("groups renders into commits with their components", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        events: [
          renderEvent({ commitId: 1 as CommitId, componentId: 1 as ComponentId }),
          renderEvent({ commitId: 1 as CommitId, componentId: 2 as ComponentId }),
          renderEvent({ commitId: 2 as CommitId, componentId: 1 as ComponentId }),
        ],
      }),
    );
    const commits = store.commits();
    expect(commits).toHaveLength(2);
    expect(new Set(commits[0]!.componentIds)).toEqual(new Set([1, 2]));
    expect(commits[1]!.componentIds).toEqual([1]);
  });

  it("bounds the commit list", () => {
    const store = new TraceStore({ maxCommits: 2 });
    const events = [1, 2, 3].map((n) =>
      renderEvent({ commitId: n as CommitId, componentId: 1 as ComponentId }),
    );
    store.ingest(batch({ events }));
    const commits = store.commits();
    expect(commits).toHaveLength(2);
    expect(commits.map((c) => c.commitId)).toEqual([2, 3]);
  });
});

describe("TraceStore — subscriptions", () => {
  it("notifies a component subscriber only for its component", () => {
    const store = new TraceStore();
    const cb = vi.fn();
    store.subscribe({ kind: "component", id: 1 as ComponentId }, cb);
    store.ingest(batch({ events: [renderEvent({ componentId: 2 as ComponentId })] }));
    expect(cb).not.toHaveBeenCalled();
    store.ingest(batch({ events: [renderEvent({ componentId: 1 as ComponentId })] }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("notifies a component subscriber when its snapshot arrives with no events", () => {
    // On-demand snapshots (large-app path) ingest in a snapshot-only batch;
    // the inspector must still re-render to read them.
    const store = new TraceStore();
    const cb = vi.fn();
    store.subscribe({ kind: "component", id: 7 as ComponentId }, cb);
    store.ingest(
      batch({
        snapshots: [
          { renderId: 99 as RenderId, componentId: 7 as ComponentId, timestamp: 1, props: { k: "undefined" } },
        ],
      }),
    );
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("global subscribers fire on any ingest", () => {
    const store = new TraceStore();
    const cb = vi.fn();
    store.subscribe({ kind: "global" }, cb);
    store.ingest(batch({ events: [renderEvent()] }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("dispose stops notifications", () => {
    const store = new TraceStore();
    const cb = vi.fn();
    const dispose = store.subscribe({ kind: "global" }, cb);
    dispose();
    store.ingest(batch({ events: [renderEvent()] }));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("TraceStore — ingest tee (Doctor worker feed)", () => {
  it("fires ingest observers with each batch and stops on dispose", () => {
    const store = new TraceStore();
    const seen: number[] = [];
    const off = store.onIngest((b) => seen.push(b.events.length));
    store.ingest(batch({ events: [renderEvent()] }));
    store.ingest(batch({ events: [renderEvent(), renderEvent()] }));
    off();
    store.ingest(batch({ events: [renderEvent()] }));
    expect(seen).toEqual([1, 2]);
  });

  it("export round-trips history into a fresh store", () => {
    const source = new TraceStore();
    source.ingest(
      batch({
        events: [renderEvent({ componentId: 1 as ComponentId }), renderEvent({ componentId: 2 as ComponentId })],
        instances: [instance(1, "A"), instance(2, "B")],
      }),
    );
    const mirror = new TraceStore();
    mirror.ingest(source.export());
    expect(mirror.stats().components).toBe(2);
    expect(mirror.renderCount(1 as ComponentId)).toBe(1);
    expect(mirror.instance(2 as ComponentId)?.name).toBe("B");
  });
});
