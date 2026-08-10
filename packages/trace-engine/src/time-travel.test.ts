import { describe, it, expect } from "vitest";
import { TraceStore } from "./trace-store.js";
import { applySetAt, diffApplySet } from "./time-travel.js";
import type {
  RenderEvent,
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  ComponentInstance,
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
