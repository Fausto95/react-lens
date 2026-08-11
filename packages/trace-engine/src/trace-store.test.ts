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
} from "@reactlens/protocol";

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

  it("returns the overwritten item when full", () => {
    const rb = new RingBuffer<number>(2);
    expect(rb.push(1)).toBeUndefined();
    expect(rb.push(2)).toBeUndefined();
    expect(rb.push(3)).toBe(1);
    expect(rb.toArray()).toEqual([2, 3]);
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

  it("drops commits whose renders were overwritten in the event ring", () => {
    const store = new TraceStore({ maxEvents: 2 });
    store.ingest(
      batch({
        events: [
          renderEvent({ commitId: 1 as CommitId, componentId: 1 as ComponentId, timestamp: 10 }),
          renderEvent({ commitId: 2 as CommitId, componentId: 1 as ComponentId, timestamp: 20 }),
          renderEvent({ commitId: 3 as CommitId, componentId: 1 as ComponentId, timestamp: 30 }),
        ],
      }),
    );
    const commits = store.commits();
    expect(commits.map((c) => c.commitId)).toEqual([2, 3]);
    expect(store.commit(1 as CommitId)).toBeUndefined();
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

  it("clear() empties the store and notifies subscribers", () => {
    const store = new TraceStore();
    store.ingest(batch({ events: [renderEvent({ componentId: 1 as ComponentId })], instances: [instance(1, "A")] }));
    const cb = vi.fn();
    store.subscribe({ kind: "global" }, cb);
    store.clear();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.stats().components).toBe(0);
    expect(store.stats().renders).toBe(0);
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

describe("TraceStore — time travel", () => {
  it("resolves the render/snapshot at or before a timestamp", () => {
    const store = new TraceStore();
    const c = 7 as ComponentId;
    store.ingest(
      batch({
        events: [
          renderEvent({ componentId: c, renderId: 10 as RenderId, timestamp: 100 }),
          renderEvent({ componentId: c, renderId: 11 as RenderId, timestamp: 200 }),
          renderEvent({ componentId: c, renderId: 12 as RenderId, timestamp: 300 }),
        ],
        snapshots: [
          { renderId: 11 as RenderId, componentId: c, timestamp: 200, props: { k: "undefined" } },
        ],
      }),
    );
    expect(store.renderAtOrBefore(c, 50)).toBeUndefined();
    expect(store.renderAtOrBefore(c, 250)?.renderId).toBe(11 as RenderId);
    expect(store.renderAtOrBefore(c, 999)?.renderId).toBe(12 as RenderId);
    // Snapshot only retained for render 11.
    expect(store.snapshotAtOrBefore(c, 250)?.renderId).toBe(11 as RenderId);
    expect(store.snapshotAtOrBefore(c, 999)).toBeUndefined();
  });

  it("finds the nearest commit at or before a timestamp", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        events: [
          renderEvent({ commitId: 1 as CommitId, timestamp: 100 }),
          renderEvent({ commitId: 2 as CommitId, timestamp: 250 }),
        ],
      }),
    );
    expect(store.commitAt(50)).toBeUndefined();
    expect(store.commitAt(200)?.commitId).toBe(1 as CommitId);
    expect(store.commitAt(999)?.commitId).toBe(2 as CommitId);
  });

  it("derives interactions from the event log", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        events: [renderEvent({ componentId: 1 as ComponentId, timestamp: 1 })],
        instances: [instance(1, "App")],
      }),
    );
    const interactions = store.interactions();
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.kind).toBe("load");
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

describe("historical queries — binary-search equivalence", () => {
  const cid = (n: number) => n as ComponentId;
  const rid = (n: number) => n as RenderId;

  /** Linear-scan oracle for renderAtOrBefore. */
  function oracleRenderAt(store: TraceStore, id: ComponentId, t: number) {
    let best;
    for (const r of store.rendersOf(id)) if (r.timestamp <= t) best = r;
    return best;
  }

  it("renderAtOrBefore matches a linear scan at every boundary", () => {
    const store = new TraceStore();
    const times = [100, 100, 150, 200, 200, 200, 350];
    store.ingest(
      batch({
        instances: [instance(1, "A")],
        events: times.map((t, i) =>
          renderEvent({ componentId: cid(1), renderId: rid(1000 + i), timestamp: t }),
        ),
      }),
    );
    const probes = [0, 99, 100, 100.5, 149, 150, 199, 200, 201, 349, 350, 999];
    for (const t of probes) {
      expect(store.renderAtOrBefore(cid(1), t)?.renderId).toBe(
        oracleRenderAt(store, cid(1), t)?.renderId,
      );
    }
  });

  it("renderAtOrBefore is exact after the ring wraps", () => {
    const store = new TraceStore({ maxRendersPerComponent: 3 });
    store.ingest(
      batch({
        instances: [instance(1, "A")],
        events: [100, 200, 300, 400, 500].map((t, i) =>
          renderEvent({ componentId: cid(1), renderId: rid(2000 + i), timestamp: t }),
        ),
      }),
    );
    expect(store.renderAtOrBefore(cid(1), 250)).toBeUndefined(); // 100/200 evicted
    expect(store.renderAtOrBefore(cid(1), 450)?.timestamp).toBe(400);
    expect(store.renderAtOrBefore(cid(1), 500)?.timestamp).toBe(500);
  });

  it("commitAt matches a linear scan and commit() is a lookup", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "A")],
        events: [
          renderEvent({ componentId: cid(1), commitId: 1 as CommitId, timestamp: 100 }),
          renderEvent({ componentId: cid(1), commitId: 2 as CommitId, timestamp: 200 }),
          renderEvent({ componentId: cid(1), commitId: 3 as CommitId, timestamp: 300 }),
        ],
      }),
    );
    expect(store.commitAt(50)).toBeUndefined();
    expect(store.commitAt(100)?.commitId).toBe(1);
    expect(store.commitAt(250)?.commitId).toBe(2);
    expect(store.commitAt(9999)?.commitId).toBe(3);
    expect(store.commit(2 as CommitId)?.componentIds).toEqual([cid(1)]);
    expect(store.commit(99 as CommitId)).toBeUndefined();
  });

  it("commits() is identity-stable between ingests and refreshes after one", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "A")],
        events: [renderEvent({ componentId: cid(1), commitId: 1 as CommitId, timestamp: 100 })],
      }),
    );
    const first = store.commits();
    expect(store.commits()).toBe(first);
    store.ingest(
      batch({
        events: [renderEvent({ componentId: cid(1), commitId: 2 as CommitId, timestamp: 200 })],
      }),
    );
    const second = store.commits();
    expect(second).not.toBe(first);
    expect(second).toHaveLength(2);
  });
});

describe("commit DOM snapshots (offline replay)", () => {
  const dom = (label: string) => ({ root: { nodeName: "DIV", text: label } });

  it("commitDomAt returns the nearest snapshot at or before t", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        commitSnapshots: [
          { commitId: 1 as CommitId, timestamp: 100, dom: dom("a") },
          { commitId: 2 as CommitId, timestamp: 300, dom: dom("b") },
        ],
      }),
    );
    expect(store.commitDomAt(50)).toBeUndefined();
    expect(store.commitDomAt(100)?.dom.root.text).toBe("a");
    expect(store.commitDomAt(250)?.dom.root.text).toBe("a");
    expect(store.commitDomAt(999)?.dom.root.text).toBe("b");
  });

  it("caps retained commit snapshots", () => {
    const store = new TraceStore({ maxCommitSnapshots: 2 });
    store.ingest(
      batch({
        commitSnapshots: [1, 2, 3].map((n) => ({
          commitId: n as CommitId,
          timestamp: n * 100,
          dom: dom(`c${n}`),
        })),
      }),
    );
    expect(store.commitDomAt(150)).toBeUndefined(); // oldest evicted
    expect(store.commitDomAt(250)?.dom.root.text).toBe("c2");
  });

  it("export round-trips commit snapshots into a fresh store", () => {
    const source = new TraceStore();
    source.ingest(
      batch({
        commitSnapshots: [{ commitId: 1 as CommitId, timestamp: 100, dom: dom("x") }],
      }),
    );
    const mirror = new TraceStore();
    mirror.ingest(source.export());
    expect(mirror.commitDomAt(100)?.dom.root.text).toBe("x");
  });
});
