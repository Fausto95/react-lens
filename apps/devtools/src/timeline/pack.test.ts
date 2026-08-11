import { describe, it, expect } from "vitest";
import { TraceStore } from "@reactlens/trace-engine";
import type {
  ComponentId,
  RenderId,
  CommitId,
  EventId,
  RenderEvent,
  ComponentInstance,
} from "@reactlens/protocol";
import { MIN_BAR_PX, greedyPack, packPhaseBars } from "./pack.js";

describe("greedyPack", () => {
  it("never overlaps two items on the same track", () => {
    const items = [
      { t0: 0, t1: 50 },
      { t0: 10, t1: 30 },
      { t0: 20, t1: 60 },
      { t0: 55, t1: 80 },
      { t0: 61, t1: 90 },
    ];
    const packed = greedyPack(items);
    const byTrack = new Map<number, Array<{ t0: number; t1: number }>>();
    for (const p of packed) {
      const list = byTrack.get(p.track) ?? [];
      list.push(p);
      byTrack.set(p.track, list);
    }
    for (const list of byTrack.values()) {
      list.sort((a, b) => a.t0 - b.t0);
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.t0 + 0.5).toBeGreaterThanOrEqual(list[i - 1]!.t1);
      }
    }
  });

  it("is deterministic and start-ordered within a track", () => {
    const items = [
      { t0: 20, t1: 60 },
      { t0: 0, t1: 50 },
    ];
    expect(greedyPack(items)).toEqual(greedyPack(items));
    const packed = greedyPack(items);
    expect(packed[0]!.t0).toBe(0);
    expect(packed[0]!.track).toBe(0);
    expect(packed[1]!.track).toBe(1);
  });

  it("reuses a track once it frees up", () => {
    const packed = greedyPack([
      { t0: 0, t1: 10 },
      { t0: 20, t1: 30 },
    ]);
    expect(packed.every((p) => p.track === 0)).toBe(true);
  });
});

describe("packPhaseBars", () => {
  let seq = 0;
  const render = (comp: number, rid: number, t: number, self = 2): RenderEvent => ({
    id: ++seq as EventId,
    type: "render",
    timestamp: t,
    renderId: rid as RenderId,
    commitId: 1 as CommitId,
    componentId: comp as ComponentId,
    selfDuration: self,
    totalDuration: self,
    reasons: [{ type: "state", hookIndex: 0 }],
    compiler: { compiled: false, memoized: false },
  });
  const inst = (id: number, name: string): ComponentInstance => ({
    id: id as ComponentId,
    type: id as never,
    name,
    rootId: 1 as never,
    compiler: { compiled: false, memoized: false },
  });

  function fixture() {
    const store = new TraceStore();
    store.ingest({
      instances: [inst(1, "A"), inst(2, "B")],
      snapshots: [],
      events: [render(1, 10, 100, 4), render(2, 11, 102, 1)],
    });
    const interaction = {
      id: "i1",
      label: "click",
      kind: "click" as const,
      start: 100,
      end: 110,
      renderIds: [10, 11] as RenderId[],
      commitIds: [1] as CommitId[],
      metrics: {
        totalDuration: 10,
        reactDuration: 5,
        renderCount: 2,
        stateUpdates: 1,
        componentIds: [1 as ComponentId, 2 as ComponentId],
      },
    };
    return { store, interaction };
  }

  it("places one bar per render at xOf(t) with a minimum width", () => {
    const { store, interaction } = fixture();
    const xOf = (t: number) => (t - 100) * 2;
    const packed = packPhaseBars(store, [interaction], xOf, 2);
    expect(packed.phases).toHaveLength(1);
    expect(packed.bars).toHaveLength(2);
    const barA = packed.bars.find((b) => b.name === "A")!;
    expect(barA.left).toBe(0);
    expect(barA.width).toBeGreaterThanOrEqual(MIN_BAR_PX);
    const barB = packed.bars.find((b) => b.name === "B")!;
    expect(barB.left).toBe(4);
  });

  it("phase summary counts every render even when bars are capped", () => {
    const { store, interaction } = fixture();
    const packed = packPhaseBars(store, [interaction], (t) => t - 100, 1);
    expect(packed.phases[0]!.renderCount).toBe(2);
    expect(packed.phases[0]!.barCount).toBeLessThanOrEqual(packed.phases[0]!.renderCount);
  });

  it("track assignment is independent of idle-gutter compression", () => {
    const store = new TraceStore();
    store.ingest({
      instances: [inst(1, "A"), inst(2, "B"), inst(3, "C")],
      snapshots: [],
      events: [render(1, 20, 100, 20), render(2, 21, 110, 20), render(3, 22, 200, 5)],
    });
    const interaction = {
      id: "i1",
      label: "click",
      kind: "click" as const,
      start: 100,
      end: 210,
      renderIds: [20, 21, 22] as RenderId[],
      commitIds: [1] as CommitId[],
      metrics: {
        totalDuration: 110,
        reactDuration: 45,
        renderCount: 3,
        stateUpdates: 1,
        componentIds: [1, 2, 3] as ComponentId[],
      },
    };
    const px = 2;
    const plain = (t: number) => (t - 100) * px;
    const shifted = (t: number) => (t - 100) * px + (t > 150 ? 34 : 0); // fake gutter
    const tracksOf = (xOf: (t: number) => number) =>
      new Map(packPhaseBars(store, [interaction], xOf, px).bars.map((b) => [b.renderId, b.track]));
    expect(tracksOf(shifted)).toEqual(tracksOf(plain));
  });

  it("track assignment is stable across zoom for overlapping renders", () => {
    const store = new TraceStore();
    store.ingest({
      instances: [inst(1, "A"), inst(2, "B"), inst(3, "C")],
      snapshots: [],
      events: [render(1, 30, 100, 20), render(2, 31, 110, 20), render(3, 32, 200, 5)],
    });
    const interaction = {
      id: "i1",
      label: "click",
      kind: "click" as const,
      start: 100,
      end: 210,
      renderIds: [30, 31, 32] as RenderId[],
      commitIds: [1] as CommitId[],
      metrics: {
        totalDuration: 110,
        reactDuration: 45,
        renderCount: 3,
        stateUpdates: 1,
        componentIds: [1, 2, 3] as ComponentId[],
      },
    };
    const tracksAt = (px: number) =>
      new Map(
        packPhaseBars(store, [interaction], (t) => (t - 100) * px, px).bars.map((b) => [
          b.renderId,
          b.track,
        ]),
      );
    const zoomedOut = tracksAt(2);
    expect(zoomedOut.get(30 as RenderId)).not.toBe(zoomedOut.get(31 as RenderId)); // overlap stacks
    expect(tracksAt(50)).toEqual(zoomedOut);
  });
});
