import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import type {
  CommitId,
  ComponentId,
  ComponentInstance,
  EventId,
  RenderEvent,
  RenderId,
} from "@reactlens/protocol";
import { buildRenderStory } from "./renderStory.js";

let seq = 0;
const inst = (id: number, name: string, parentId?: number): ComponentInstance => ({
  id: id as ComponentId,
  type: id as never,
  name,
  rootId: 1 as never,
  compiler: { compiled: false, memoized: false },
  ...(parentId !== undefined ? { parentId: parentId as ComponentId } : {}),
});

const render = (comp: number, rid: number, self: number, total: number): RenderEvent => ({
  id: ++seq as EventId,
  type: "render",
  timestamp: 100,
  renderId: rid as RenderId,
  commitId: 1 as CommitId,
  componentId: comp as ComponentId,
  selfDuration: self,
  totalDuration: total,
  reasons: [{ type: "state", hookIndex: 0 }],
  compiler: { compiled: false, memoized: false },
});

/** A parent that does 2ms itself while its subtree does 40ms. */
function parentWithHeavySubtree() {
  const store = new TraceStore();
  store.ingest({
    instances: [inst(1, "ProductList")],
    snapshots: [],
    events: [render(1, 10, 2, 42)],
  });
  return store;
}

describe("render story cost", () => {
  it("reports the component's own work as render", () => {
    const store = parentWithHeavySubtree();
    const story = buildRenderStory(store, createCausality(store), 10 as RenderId)!;
    expect(story.cost.render).toBe(2);
  });

  it("reports children's time as subtree, not as an invented commit cost", () => {
    // `totalDuration - selfDuration` is the SUBTREE. Reporting it as "commit"
    // (and rescaling it) made a parent's bar almost entirely one colour, so it
    // read as a progress bar instead of a breakdown.
    const store = parentWithHeavySubtree();
    const story = buildRenderStory(store, createCausality(store), 10 as RenderId)!;
    expect(story.cost.subtree).toBe(40);
  });

  it("never lets a segment exceed the render's measured total", () => {
    const store = parentWithHeavySubtree();
    const story = buildRenderStory(store, createCausality(store), 10 as RenderId)!;
    const total = story.cost.render + story.cost.subtree + story.cost.effects;
    expect(total).toBeLessThanOrEqual(42 + 1e-9);
  });

  it("is all render time for a leaf that has no children", () => {
    const store = new TraceStore();
    store.ingest({
      instances: [inst(2, "Leaf")],
      snapshots: [],
      events: [render(2, 20, 3, 3)],
    });
    const story = buildRenderStory(store, createCausality(store), 20 as RenderId)!;
    expect(story.cost.render).toBe(3);
    expect(story.cost.subtree).toBe(0);
  });

  it("never reports a negative segment", () => {
    const store = new TraceStore();
    store.ingest({
      instances: [inst(3, "Odd")],
      snapshots: [],
      // Defensive: totalDuration below selfDuration should not go negative.
      events: [render(3, 30, 5, 1)],
    });
    const story = buildRenderStory(store, createCausality(store), 30 as RenderId)!;
    expect(story.cost.subtree).toBeGreaterThanOrEqual(0);
    expect(story.cost.render).toBeGreaterThanOrEqual(0);
  });
});
