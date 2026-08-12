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
import { cascadeSize, chainFor, edgesForCommit, originOf } from "./edges.js";

let seq = 0;
const inst = (id: number, name: string, parentId?: number): ComponentInstance => ({
  id: id as ComponentId,
  type: id as never,
  name,
  rootId: 1 as never,
  compiler: { compiled: false, memoized: false },
  ...(parentId !== undefined ? { parentId: parentId as ComponentId } : {}),
});

const render = (
  comp: number,
  rid: number,
  commit: number,
  reason: RenderEvent["reasons"][number],
  t = rid,
): RenderEvent => ({
  id: ++seq as EventId,
  type: "render",
  timestamp: t,
  renderId: rid as RenderId,
  commitId: commit as CommitId,
  componentId: comp as ComponentId,
  selfDuration: 1,
  totalDuration: 1,
  reasons: [reason],
  compiler: { compiled: false, memoized: false },
});

/**
 * The cart cascade in miniature:
 *   Provider(state) → Badge(context), List(context) → Item×3(props)
 */
function cascade() {
  const store = new TraceStore();
  const items = [40, 41, 42];
  store.ingest({
    instances: [
      inst(1, "App"),
      inst(2, "CartProvider", 1),
      inst(3, "CartBadge", 2),
      inst(4, "ProductList", 2),
      ...items.map((id) => inst(id, "ListItem", 4)),
    ],
    snapshots: [],
    events: [
      render(2, 10, 1, { type: "state", hookIndex: 0 }),
      render(3, 11, 1, { type: "context", contextType: 99 as never }),
      render(4, 12, 1, { type: "context", contextType: 99 as never }),
      ...items.map((id, i) => render(id, 20 + i, 1, { type: "props", changed: ["onSelect"] })),
    ],
  });
  return store;
}

describe("edgesForCommit", () => {
  it("hangs each render off the nearest ancestor that rendered in the commit", () => {
    const edges = edgesForCommit(cascade(), 12 as RenderId).edges;
    const pairs = edges.map((e) => [e.from, e.to]);
    expect(pairs).toContainEqual([10, 11]); // provider → badge
    expect(pairs).toContainEqual([10, 12]); // provider → list
    expect(pairs).toContainEqual([12, 20]); // list → item
    expect(pairs).toContainEqual([12, 21]);
    expect(pairs).toContainEqual([12, 22]);
  });

  it("treats a local state update as an origin — it has no incoming edge", () => {
    const { edges } = edgesForCommit(cascade(), 10 as RenderId);
    expect(edges.some((e) => e.to === 10)).toBe(false);
  });

  it("colours the edge by what the TARGET did", () => {
    const { edges } = edgesForCommit(cascade(), 12 as RenderId);
    expect(edges.find((e) => e.to === 11)?.cause).toBe("context");
    expect(edges.find((e) => e.to === 20)?.cause).toBe("props");
  });

  it("skips a component whose ancestor did not render", () => {
    const store = new TraceStore();
    store.ingest({
      instances: [inst(1, "App"), inst(2, "Orphan", 1)],
      snapshots: [],
      // App never rendered in this commit, so Orphan has nothing to hang off.
      events: [render(2, 30, 7, { type: "props", changed: ["x"] })],
    });
    expect(edgesForCommit(store, 30 as RenderId).edges).toHaveLength(0);
  });

  it("is empty for an unknown render rather than throwing", () => {
    expect(edgesForCommit(cascade(), 999 as RenderId).edges).toHaveLength(0);
  });
});

describe("chainFor", () => {
  it("returns every edge the selection is an endpoint of — in and out", () => {
    const commit = edgesForCommit(cascade(), 12 as RenderId);
    const drawn = chainFor(commit, 12 as RenderId);
    // 1 incoming (provider → list) + 3 outgoing (list → each item).
    expect(drawn).toHaveLength(4);
    expect(drawn.filter((e) => e.to === 12)).toHaveLength(1);
    expect(drawn.filter((e) => e.from === 12)).toHaveLength(3);
  });

  it("fans out from the origin to everything it directly caused", () => {
    const commit = edgesForCommit(cascade(), 10 as RenderId);
    expect(chainFor(commit, 10 as RenderId)).toHaveLength(2); // badge + list
  });

  it("has nothing to draw for a render outside the graph", () => {
    const commit = edgesForCommit(cascade(), 12 as RenderId);
    expect(chainFor(commit, 999 as RenderId)).toHaveLength(0);
  });
});

describe("originOf / cascadeSize", () => {
  it("walks back to the state update that started it", () => {
    const commit = edgesForCommit(cascade(), 20 as RenderId);
    expect(originOf(commit, 20 as RenderId)).toBe(10);
  });

  it("counts everything downstream of the origin", () => {
    const commit = edgesForCommit(cascade(), 10 as RenderId);
    // badge + list + 3 items
    expect(cascadeSize(commit, 10 as RenderId)).toBe(5);
  });

  it("an origin is its own origin", () => {
    const commit = edgesForCommit(cascade(), 10 as RenderId);
    expect(originOf(commit, 10 as RenderId)).toBe(10);
  });
});
