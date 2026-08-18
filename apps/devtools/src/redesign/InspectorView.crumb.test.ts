import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import type {
  CommitId,
  ComponentId,
  ComponentInstance,
  EventId,
  RenderEvent,
  RenderId,
} from "@reactlens/protocol";
import { renderInSameCommit } from "./InspectorView.js";

let seq = 0;
const inst = (id: number, name: string, parentId?: number): ComponentInstance => ({
  id: id as ComponentId,
  type: id as never,
  name,
  rootId: 1 as never,
  compiler: { compiled: false, memoized: false },
  ...(parentId !== undefined ? { parentId: parentId as ComponentId } : {}),
});

const render = (comp: number, rid: number, commit: number): RenderEvent => ({
  id: ++seq as EventId,
  type: "render",
  timestamp: 100 + rid,
  renderId: rid as RenderId,
  commitId: commit as CommitId,
  componentId: comp as ComponentId,
  selfDuration: 1,
  totalDuration: 1,
  reasons: [{ type: "parent", componentId: 1 as ComponentId }],
  compiler: { compiled: false, memoized: false },
});

function storeWithAppPageCard() {
  const store = new TraceStore();
  store.ingest({
    instances: [inst(1, "App"), inst(2, "Page", 1), inst(3, "Card", 2)],
    snapshots: [],
    events: [render(1, 10, 1), render(2, 11, 1), render(3, 12, 1), render(3, 22, 2)],
  });
  return store;
}

describe("renderInSameCommit", () => {
  it("finds the ancestor's clip in the same commit", () => {
    const store = storeWithAppPageCard();
    expect(renderInSameCommit(store, 12 as RenderId, 2 as ComponentId)).toBe(11);
    expect(renderInSameCommit(store, 12 as RenderId, 1 as ComponentId)).toBe(10);
  });

  it("returns the seed when asked for its own component", () => {
    const store = storeWithAppPageCard();
    expect(renderInSameCommit(store, 12 as RenderId, 3 as ComponentId)).toBe(12);
  });

  it("prefers the same-commit render over a later one of that component", () => {
    const store = storeWithAppPageCard();
    expect(renderInSameCommit(store, 11 as RenderId, 3 as ComponentId)).toBe(12);
  });

  it("returns null when that ancestor did not render in this commit", () => {
    const store = new TraceStore();
    store.ingest({
      instances: [inst(1, "App"), inst(2, "Page", 1)],
      snapshots: [],
      events: [render(2, 11, 1)],
    });
    expect(renderInSameCommit(store, 11 as RenderId, 1 as ComponentId)).toBeNull();
  });
});
