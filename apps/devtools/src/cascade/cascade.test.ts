import { describe, expect, it } from "vite-plus/test";
import type { Interaction, TraceStore } from "@reactlens/trace-engine";
import type { CommitId, ComponentId, RenderEvent, RenderId } from "@reactlens/protocol";
import { buildCascadeProjection } from "./model.js";

const cid = (n: number) => n as ComponentId;
const rid = (n: number) => n as RenderId;
const commit = (n: number) => n as CommitId;

function render(
  id: number,
  componentId: number,
  reason: RenderEvent["reasons"][number],
  timestamp: number,
): RenderEvent {
  return {
    id: id as RenderEvent["id"],
    type: "render",
    timestamp,
    renderId: rid(id),
    commitId: commit(1),
    componentId: cid(componentId),
    selfDuration: id / 10,
    totalDuration: id / 8,
    reasons: [reason],
    compiler: { compiled: false, memoized: false },
  };
}

function fixture() {
  const renders = new Map<RenderId, RenderEvent>();
  renders.set(rid(1), render(1, 1, { type: "state", hookIndex: 0 }, 10));
  renders.set(rid(2), render(2, 2, { type: "parent", componentId: cid(1) }, 10.2));
  for (let i = 0; i < 7; i++) {
    renders.set(
      rid(3 + i),
      render(3 + i, 10 + i, { type: "parent", componentId: cid(2) }, 10.4 + i * 0.01),
    );
  }
  const instances = new Map<
    number,
    {
      id: ComponentId;
      name: string;
      parentId?: ComponentId;
      compiler?: { compiled: boolean; memoized: boolean };
    }
  >();
  instances.set(1, {
    id: cid(1),
    name: "CartProvider",
    compiler: { compiled: true, memoized: true },
  });
  instances.set(2, {
    id: cid(2),
    name: "ProductList",
    parentId: cid(1),
    compiler: { compiled: false, memoized: false },
  });
  for (let i = 0; i < 7; i++)
    instances.set(10 + i, {
      id: cid(10 + i),
      name: "ProductCard",
      parentId: cid(2),
      // A deliberate mix, so an aggregate over them can claim nothing.
      compiler: { compiled: i % 2 === 0, memoized: i % 2 === 0 },
    });
  const store = {
    getRender: (id: RenderId) => renders.get(id),
    instance: (id: ComponentId) => instances.get(id as number),
  } as unknown as TraceStore;
  const interaction: Interaction = {
    id: "i1",
    label: "Click CartButton",
    kind: "click",
    start: 10,
    end: 11,
    renderIds: [...renders.keys()],
    commitIds: [commit(1)],
    metrics: {
      totalDuration: 1,
      reactDuration: 4,
      renderCount: renders.size,
      stateUpdates: 1,
      componentIds: [...instances.values()].map((x) => x.id),
    },
  };
  return { store, interaction };
}

function mountFixture() {
  const renders = new Map<RenderId, RenderEvent>();
  renders.set(rid(1), render(1, 1, { type: "mount" }, 10));
  renders.set(rid(2), render(2, 2, { type: "mount" }, 10.1));
  renders.set(rid(3), render(3, 3, { type: "mount" }, 10.2));
  const instances = new Map<number, { id: ComponentId; name: string; parentId?: ComponentId }>([
    [1, { id: cid(1), name: "App" }],
    [2, { id: cid(2), name: "Storefront", parentId: cid(1) }],
    [3, { id: cid(3), name: "Catalog", parentId: cid(2) }],
  ]);
  const store = {
    getRender: (id: RenderId) => renders.get(id),
    instance: (id: ComponentId) => instances.get(id as number),
  } as unknown as TraceStore;
  const interaction: Interaction = {
    id: "load",
    label: "Load",
    kind: "load",
    start: 10,
    end: 11,
    renderIds: [...renders.keys()],
    commitIds: [commit(1)],
    metrics: {
      totalDuration: 1,
      reactDuration: 1,
      renderCount: renders.size,
      stateUpdates: 0,
      componentIds: [...instances.values()].map((x) => x.id),
    },
  };
  return { store, interaction };
}

/**
 *  App (state)
 *  └─ Layout (parent)
 *     ├─ Card (props: items·onSelect) — owned by App, so a cross-tree edge
 *     │  └─ Field (props: value) — owned by Card, its own parent
 *     ├─ Ghost (props) — owned by #99, a component the trace never saw
 *     └─ Row ×3 (props) — two owners that share a name but not an id
 */
function ownerFixture() {
  const renders = new Map<RenderId, RenderEvent>();
  renders.set(rid(1), render(1, 1, { type: "state", hookIndex: 0 }, 10));
  renders.set(rid(2), render(2, 2, { type: "parent", componentId: cid(1) }, 10.1));
  renders.set(rid(3), render(3, 3, { type: "props", changed: ["items", "onSelect"] }, 10.2));
  renders.set(rid(4), render(4, 4, { type: "props", changed: ["value"] }, 10.3));
  renders.set(rid(5), render(5, 5, { type: "props", changed: ["x"] }, 10.4));
  renders.set(rid(6), render(6, 10, { type: "props", changed: ["a", "b"] }, 10.5));
  renders.set(rid(7), render(7, 11, { type: "props", changed: ["b", "c"] }, 10.6));
  renders.set(rid(8), render(8, 12, { type: "props", changed: ["d"] }, 10.7));
  const instances = new Map<
    number,
    { id: ComponentId; name: string; parentId?: ComponentId; ownerId?: ComponentId }
  >([
    [1, { id: cid(1), name: "App" }],
    [2, { id: cid(2), name: "Layout", parentId: cid(1), ownerId: cid(1) }],
    [3, { id: cid(3), name: "Card", parentId: cid(2), ownerId: cid(1) }],
    [4, { id: cid(4), name: "Field", parentId: cid(3), ownerId: cid(3) }],
    [5, { id: cid(5), name: "Ghost", parentId: cid(2), ownerId: cid(99) }],
    [10, { id: cid(10), name: "Row", parentId: cid(2), ownerId: cid(20) }],
    [11, { id: cid(11), name: "Row", parentId: cid(2), ownerId: cid(20) }],
    [12, { id: cid(12), name: "Row", parentId: cid(2), ownerId: cid(21) }],
    [20, { id: cid(20), name: "RowHost" }],
    [21, { id: cid(21), name: "RowHost" }],
  ]);
  const store = {
    getRender: (id: RenderId) => renders.get(id),
    instance: (id: ComponentId) => instances.get(id as number),
  } as unknown as TraceStore;
  const interaction: Interaction = {
    id: "owners",
    label: "Click",
    kind: "click",
    start: 10,
    end: 11,
    renderIds: [...renders.keys()],
    commitIds: [commit(1)],
    metrics: {
      totalDuration: 1,
      reactDuration: 1,
      renderCount: renders.size,
      stateUpdates: 1,
      componentIds: [...instances.values()].map((x) => x.id),
    },
  };
  return { store, interaction };
}

describe("cascade projection", () => {
  it("builds causal depth from the interaction only", () => {
    const { store, interaction } = fixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 99 });
    expect(projection.totalRenderCount).toBe(9);
    expect(projection.roots).toEqual(["r:1"]);
    expect(projection.nodes.find((node) => node.id === "r:1")?.depth).toBe(0);
    expect(projection.nodes.find((node) => node.id === "r:2")?.depth).toBe(1);
    expect(projection.nodes.find((node) => node.id === "r:3")?.depth).toBe(2);
  });

  it("keeps mount as the cause while preserving structural ancestry", () => {
    const { store, interaction } = mountFixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 99 });
    expect(projection.roots).toEqual(["r:1"]);
    expect(projection.nodes.find((node) => node.id === "r:1")?.name).toBe("App");
    expect(projection.nodes.find((node) => node.id === "r:1")?.depth).toBe(0);
    expect(projection.nodes.find((node) => node.id === "r:2")?.depth).toBe(1);
    expect(projection.nodes.find((node) => node.id === "r:3")?.depth).toBe(2);
    expect(projection.nodes.every((node) => node.cause === "mount")).toBe(true);
  });

  it("collapses repeated leaf siblings instead of flooding the canvas", () => {
    const { store, interaction } = fixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 6 });
    const aggregate = projection.nodes.find((node) => node.kind === "aggregate");
    expect(aggregate?.name).toBe("ProductCard ×7");
    expect(aggregate?.aggregateCount).toBe(7);
    expect(projection.nodes.length).toBe(3);
  });

  it("enforces the visible-node budget for pathological fan-out", () => {
    const { store, interaction } = fixture();
    const projection = buildCascadeProjection(store, interaction, {
      aggregateThreshold: 99,
      maxVisibleNodes: 4,
    });
    expect(projection.nodes.length).toBeLessThanOrEqual(4);
    expect(projection.nodes.some((node) => node.id === "g:overflow")).toBe(true);
    expect(projection.totalRenderCount).toBe(9);
  });

  it("carries React Compiler status through to every lens", () => {
    const { store, interaction } = fixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 99 });
    const provider = projection.nodes.find((node) => node.name === "CartProvider")!;
    const list = projection.nodes.find((node) => node.name === "ProductList")!;
    expect(provider.compiled).toBe(true);
    expect(list.compiled).toBe(false);
  });

  it("calls an aggregate compiled only when every member is", () => {
    const { store, interaction } = fixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 2 });
    const group = projection.nodes.find((node) => node.kind === "aggregate")!;
    // The ProductCard instances are a mix, so the group claims nothing.
    expect(group.compiled).toBe(null);
  });

  it("marks a props render whose owner is not its cascade parent as a cross-tree edge", () => {
    const { store, interaction } = ownerFixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 99 });
    const byName = (name: string) => projection.nodes.find((node) => node.name === name)!;
    // Card sits under Layout but App created its element: the props came from App.
    expect(byName("Card").ownerEdge).toBe(true);
    expect(byName("Card").ownerName).toBe("App");
    // Field's owner is its parent — the ordinary case, nothing to point at.
    expect(byName("Field").ownerEdge).toBe(false);
    // A state update has no incoming props edge to speak of.
    expect(byName("App").ownerEdge).toBe(null);
  });

  it("carries the prop keys that crossed each render", () => {
    const { store, interaction } = ownerFixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 99 });
    expect(projection.nodes.find((node) => node.name === "Card")?.changedProps).toEqual([
      "items",
      "onSelect",
    ]);
    expect(projection.nodes.find((node) => node.name === "Layout")?.changedProps).toEqual([]);
  });

  it("names an owner the trace never saw by id rather than dropping the edge", () => {
    const { store, interaction } = ownerFixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 99 });
    const ghost = projection.nodes.find((node) => node.name === "Ghost")!;
    expect(ghost.ownerEdge).toBe(true);
    expect(ghost.ownerName).toBe("#99");
  });

  it("lets an aggregate claim an owner only when every member has the same one", () => {
    const { store, interaction } = ownerFixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 3 });
    const rows = projection.nodes.find((node) => node.name === "Row ×3")!;
    // Two RowHost instances share a name, not an id — the name must not paper over that.
    expect(rows.ownerId).toBe(null);
    expect(rows.ownerName).toBe(null);
    expect(rows.ownerEdge).toBe(true);
    expect(rows.changedProps).toEqual(["a", "b", "c", "d"]);
  });
});
