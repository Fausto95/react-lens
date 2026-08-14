import { describe, expect, it } from "vite-plus/test";
import type { Interaction, TraceStore } from "@reactlens/trace-engine";
import type { CommitId, ComponentId, RenderEvent, RenderId } from "@reactlens/protocol";
import { buildCascadeProjection } from "./model.js";
import { layoutCascade } from "./layout.js";
import { CascadeSpatialIndex } from "./spatial.js";

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
  const instances = new Map<number, { id: ComponentId; name: string; parentId?: ComponentId }>();
  instances.set(1, { id: cid(1), name: "CartProvider" });
  instances.set(2, { id: cid(2), name: "ProductList", parentId: cid(1) });
  for (let i = 0; i < 7; i++)
    instances.set(10 + i, { id: cid(10 + i), name: "ProductCard", parentId: cid(2) });
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

  it("is deterministic across repeated layout passes", () => {
    const { store, interaction } = fixture();
    const projection = buildCascadeProjection(store, interaction, { aggregateThreshold: 99 });
    const a = layoutCascade(projection);
    const b = layoutCascade(projection);
    expect(a.nodes.map((node) => [node.node.id, node.rect])).toEqual(
      b.nodes.map((node) => [node.node.id, node.rect]),
    );
  });
});

describe("cascade spatial index", () => {
  it("hits nodes in world coordinates independent of viewport pan/zoom", () => {
    const { store, interaction } = fixture();
    const layout = layoutCascade(
      buildCascadeProjection(store, interaction, { aggregateThreshold: 99 }),
    );
    const index = new CascadeSpatialIndex(layout.nodes);
    const node = layout.nodeById.get("r:2")!;
    const hit = index.hit(node.rect.x + 5, node.rect.y + 5);
    expect(hit?.node.id).toBe("r:2");
  });
});
