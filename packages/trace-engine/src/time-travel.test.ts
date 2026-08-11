import { describe, it, expect } from "vitest";
import { TraceStore } from "./trace-store.js";
import { applySetAt, compareApplySets, createApplySetCursor, diffApplySet } from "./time-travel.js";
import type {
  RenderEvent,
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  ComponentInstance,
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

const cid = (n: number) => n as ComponentId;
const rid = (n: number) => n as RenderId;

describe("applySetAt", () => {
  it("maps each instance to its render at or before t", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "A"), instance(2, "B")],
        events: [
          renderEvent({ componentId: cid(1), renderId: rid(10), timestamp: 100 }),
          renderEvent({ componentId: cid(2), renderId: rid(11), timestamp: 150 }),
          renderEvent({ componentId: cid(1), renderId: rid(12), timestamp: 200 }),
          renderEvent({ componentId: cid(2), renderId: rid(13), timestamp: 300 }),
        ],
      }),
    );
    const set = applySetAt(store, 250);
    expect(set.get(cid(1))).toBe(rid(12));
    expect(set.get(cid(2))).toBe(rid(11));
  });

  it("omits components first rendered after t", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "Early"), instance(2, "Late")],
        events: [
          renderEvent({ componentId: cid(1), renderId: rid(10), timestamp: 100 }),
          renderEvent({ componentId: cid(2), renderId: rid(11), timestamp: 500 }),
        ],
      }),
    );
    const set = applySetAt(store, 200);
    expect(set.has(cid(1))).toBe(true);
    expect(set.has(cid(2))).toBe(false);
  });

  it("omits instances whose render history was evicted before t", () => {
    // Ring cap of 2 renders per component: renders at t=100,200,300 keep 200/300.
    const store = new TraceStore({ maxRendersPerComponent: 2 });
    store.ingest(
      batch({
        instances: [instance(1, "A")],
        events: [
          renderEvent({ componentId: cid(1), renderId: rid(10), timestamp: 100 }),
          renderEvent({ componentId: cid(1), renderId: rid(11), timestamp: 200 }),
          renderEvent({ componentId: cid(1), renderId: rid(12), timestamp: 300 }),
        ],
      }),
    );
    // t=150: only the evicted render(10) was ≤ t, so no entry.
    expect(applySetAt(store, 150).has(cid(1))).toBe(false);
    expect(applySetAt(store, 250).get(cid(1))).toBe(rid(11));
  });
});

describe("diffApplySet", () => {
  it("returns only new or changed entries", () => {
    const prev = new Map([
      [cid(1), rid(10)],
      [cid(2), rid(11)],
    ]);
    const next = new Map([
      [cid(1), rid(10)], // unchanged
      [cid(2), rid(12)], // changed
      [cid(3), rid(13)], // new
    ]);
    const delta = diffApplySet(prev, next);
    expect(delta).toEqual(
      expect.arrayContaining([
        { componentId: cid(2), renderId: rid(12) },
        { componentId: cid(3), renderId: rid(13) },
      ]),
    );
    expect(delta).toHaveLength(2);
  });

  it("returns empty when nothing changed", () => {
    const prev = new Map([[cid(1), rid(10)]]);
    expect(diffApplySet(prev, new Map(prev))).toEqual([]);
  });

  it("ignores entries that disappeared from next (nothing to reset to)", () => {
    const prev = new Map([
      [cid(1), rid(10)],
      [cid(2), rid(11)],
    ]);
    const next = new Map([[cid(1), rid(10)]]);
    expect(diffApplySet(prev, next)).toEqual([]);
  });

  it("emits everything against an empty prev", () => {
    const next = new Map([[cid(1), rid(10)]]);
    expect(diffApplySet(new Map(), next)).toEqual([{ componentId: cid(1), renderId: rid(10) }]);
  });
});

describe("createApplySetCursor", () => {
  /** Deterministic pseudo-random session: many components, interleaved commits. */
  function scriptedStore(): { store: TraceStore; times: number[] } {
    const store = new TraceStore();
    const instances = [1, 2, 3, 4, 5].map((n) => instance(n, `C${n}`));
    const events: RenderEvent[] = [];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let t = 0;
    let renderSeq = 5000;
    for (let commit = 1; commit <= 40; commit++) {
      t += 10 + Math.floor(rand() * 50);
      const count = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        const comp = 1 + Math.floor(rand() * 5);
        events.push(
          renderEvent({
            componentId: comp as ComponentId,
            renderId: (renderSeq++) as RenderId,
            commitId: commit as CommitId,
            timestamp: t,
          }),
        );
      }
    }
    store.ingest(batch({ instances, events }));
    const times = [...new Set(events.map((e) => e.timestamp))].sort((a, b) => a - b);
    return { store, times };
  }

  it("any walk of moveTo(t) equals a fresh applySetAt(t)", () => {
    const { store, times } = scriptedStore();
    const cursor = createApplySetCursor(store);
    // Probe boundaries, midpoints, and jumps in both directions.
    const probes: number[] = [];
    for (let i = 0; i < times.length; i += 3) probes.push(times[i]!, times[i]! + 0.5);
    probes.push(0, times.at(-1)! + 100);
    probes.push(...[...probes].reverse());
    for (const t of probes) {
      expect(cursor.moveTo(t)).toEqual(applySetAt(store, t));
    }
  });

  it("reset() recovers after new ingestion", () => {
    const { store } = scriptedStore();
    const cursor = createApplySetCursor(store);
    cursor.moveTo(500);
    store.ingest(
      batch({
        events: [
          renderEvent({
            componentId: cid(1),
            renderId: rid(9999),
            commitId: 999 as CommitId,
            timestamp: 5000,
          }),
        ],
      }),
    );
    cursor.reset();
    expect(cursor.moveTo(6000)).toEqual(applySetAt(store, 6000));
  });
});

describe("createApplySetCursor — commits whose renders span time", () => {
  it("touches components whose render sits after the commit's start timestamp", () => {
    // One commit, renders at t=100/150/200: the commit summary starts at 100,
    // but c2's render (150) and c1's second render (200) must still be seen
    // when the cursor crosses (120, 250].
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "A"), instance(2, "B")],
        events: [
          renderEvent({ componentId: cid(1), renderId: rid(10), commitId: 1 as CommitId, timestamp: 100 }),
          renderEvent({ componentId: cid(2), renderId: rid(11), commitId: 1 as CommitId, timestamp: 150 }),
          renderEvent({ componentId: cid(1), renderId: rid(12), commitId: 1 as CommitId, timestamp: 200 }),
        ],
      }),
    );
    const cursor = createApplySetCursor(store);
    expect(cursor.moveTo(120)).toEqual(applySetAt(store, 120));
    expect(cursor.moveTo(250)).toEqual(applySetAt(store, 250));
    expect(cursor.moveTo(120)).toEqual(applySetAt(store, 120));
  });
});

describe("compareApplySets", () => {
  it("classifies components as changed/added/removed between A and B", () => {
    const store = new TraceStore();
    store.ingest(
      batch({
        instances: [instance(1, "Same"), instance(2, "Changed"), instance(3, "Born")],
        events: [
          renderEvent({ componentId: cid(1), renderId: rid(10), timestamp: 100 }),
          renderEvent({ componentId: cid(2), renderId: rid(11), timestamp: 100 }),
          renderEvent({ componentId: cid(2), renderId: rid(12), timestamp: 300 }),
          renderEvent({ componentId: cid(3), renderId: rid(13), timestamp: 350 }),
        ],
      }),
    );
    const result = compareApplySets(store, 150, 400);
    const byId = new Map(result.changed.map((c) => [c.componentId, c]));
    expect(byId.has(cid(1))).toBe(false); // same render both sides
    expect(result.unchangedCount).toBe(1);
    expect(byId.get(cid(2))).toEqual({
      componentId: cid(2),
      renderA: rid(11),
      renderB: rid(12),
    });
    expect(byId.get(cid(3))).toEqual({
      componentId: cid(3),
      renderA: null,
      renderB: rid(13),
    });
  });

  it("is symmetric-aware: components only present at A report renderB null", () => {
    const store = new TraceStore({ maxRendersPerComponent: 1 });
    store.ingest(
      batch({
        instances: [instance(1, "Evicted")],
        events: [
          renderEvent({ componentId: cid(1), renderId: rid(10), timestamp: 100 }),
          renderEvent({ componentId: cid(1), renderId: rid(11), timestamp: 500 }),
        ],
      }),
    );
    // Ring keeps only render 11 (t=500): at A=200 nothing retained, at B=600 render 11.
    const result = compareApplySets(store, 200, 600);
    expect(result.changed).toEqual([{ componentId: cid(1), renderA: null, renderB: rid(11) }]);
  });
});
