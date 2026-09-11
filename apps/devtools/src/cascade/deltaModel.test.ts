import { describe, expect, it } from "vite-plus/test";
import type { Interaction, TraceStore } from "@reactlens/trace-engine";
import type { CommitId, ComponentId, RenderEvent, RenderId } from "@reactlens/protocol";
import type { CascadeCause, CascadeNode, CascadeProjection } from "./model.js";
import { diffCascades, originKeyOf, previousComparable } from "./deltaModel.js";

let seq = 0;

function node(
  id: string,
  name: string,
  parentId: string | null,
  cause: CascadeCause,
  overrides: Partial<CascadeNode> = {},
): CascadeNode {
  seq += 1;
  return {
    id,
    kind: "render",
    renderId: seq as RenderId,
    renderIds: [seq as RenderId],
    componentId: seq as ComponentId,
    commitId: 1 as CommitId,
    name,
    cause,
    timestamp: seq,
    duration: 1,
    selfDuration: 1,
    depth: parentId === null ? 0 : 1,
    parentId,
    childCount: 0,
    aggregateCount: 1,
    compiled: null,
    ownerId: null,
    ownerName: null,
    ownerEdge: null,
    changedProps: [],
    ...overrides,
  } as CascadeNode;
}

function projection(id: string, nodes: CascadeNode[]): CascadeProjection {
  return {
    interaction: { id, label: id, start: 0, end: 1 } as CascadeProjection["interaction"],
    nodes,
    edges: [],
    roots: nodes.filter((n) => n.parentId === null).map((n) => n.id),
    totalRenderCount: nodes.length,
    totalSelfTime: nodes.length,
    maxDepth: 1,
    aggregatedRenderCount: 0,
  };
}

/**
 *  before: App ── Card (items)          ── Badge
 *  after:  App ── Card (items·onSelect) ── Toast (new) ── Row ×3 (owned from afar, new)
 *  Badge is gone.
 */
const before = projection("i1", [
  node("a", "App", null, "state"),
  node("c", "Card", "a", "props", { changedProps: ["items"] }),
  node("b", "Badge", "a", "context"),
]);
const after = projection("i2", [
  node("a2", "App", null, "state"),
  node("c2", "Card", "a2", "props", { changedProps: ["items", "onSelect"] }),
  node("t2", "Toast", "a2", "props", { changedProps: ["message"] }),
  node("r2", "Row ×3", "a2", "props", {
    kind: "aggregate",
    aggregateCount: 3,
    changedProps: ["index"],
    ownerName: "Grid",
    ownerEdge: true,
  }),
]);

describe("diffCascades", () => {
  it("flags renders of components the previous interaction did not render", () => {
    const delta = diffCascades(before, after);
    expect([...delta.newRenders].sort()).toEqual(["r2", "t2"]);
    // Aggregates key by base name, like the roll-up.
    expect(delta.newRenders.has("r2")).toBe(true);
  });

  it("flags prop keys that did not cross for that component before", () => {
    const delta = diffCascades(before, after);
    expect(delta.newKeysByNode.get("c2")).toEqual(["onSelect"]);
    // A brand-new render's keys are all new, but that is already said by newRenders.
    expect(delta.newKeysByNode.has("t2")).toBe(false);
    expect(delta.newKeysByNode.has("a2")).toBe(false);
  });

  it("names the components that rendered before and not now", () => {
    expect(diffCascades(before, after).gone).toEqual(["Badge"]);
  });

  it("unions every changed node so the ledger can keep just those and their ancestors", () => {
    expect([...diffCascades(before, after).changed].sort()).toEqual(["c2", "r2", "t2"]);
  });

  it("reports nothing for an interaction identical to its predecessor", () => {
    const delta = diffCascades(before, before);
    expect(delta.changed.size).toBe(0);
    expect(delta.gone).toEqual([]);
  });
});

describe("originKeyOf / previousComparable", () => {
  const cid = (n: number) => n as ComponentId;
  const rid = (n: number) => n as RenderId;
  function render(id: number, componentId: number, reason: RenderEvent["reasons"][number]) {
    return {
      id: id as RenderEvent["id"],
      type: "render",
      timestamp: id,
      renderId: rid(id),
      commitId: 1 as CommitId,
      componentId: cid(componentId),
      selfDuration: 0.1,
      totalDuration: 0.1,
      reasons: [reason],
      compiler: { compiled: false, memoized: false },
    } as RenderEvent;
  }
  const renders = new Map<RenderId, RenderEvent>([
    [rid(1), render(1, 1, { type: "state", hookIndex: 0 })],
    [rid(2), render(2, 2, { type: "parent", componentId: cid(1) })],
    [rid(3), render(3, 3, { type: "state", hookIndex: 0 })],
    [rid(4), render(4, 1, { type: "state", hookIndex: 1 })],
    [rid(5), render(5, 4, { type: "mount" })],
  ]);
  const names = new Map([
    [1, "CartButton"],
    [2, "Badge"],
    [3, "SearchBox"],
    [4, "App"],
  ]);
  const store = {
    getRender: (id: RenderId) => renders.get(id),
    instance: (id: ComponentId) => ({ id, name: names.get(id as number) ?? "?" }),
  } as unknown as TraceStore;
  function interaction(id: string, label: string, ...renderIds: number[]): Interaction {
    return {
      id,
      label,
      kind: "click",
      start: Math.min(...renderIds),
      end: Math.max(...renderIds) + 1,
      renderIds: renderIds.map(rid),
      commitIds: [1 as CommitId],
      metrics: {
        totalDuration: 1,
        reactDuration: 1,
        renderCount: renderIds.length,
        stateUpdates: 0,
        componentIds: [],
      },
    };
  }

  it("keys an interaction by the components whose state started it", () => {
    expect(originKeyOf(store, interaction("a", "Click", 1, 2))).toBe("CartButton");
    // The same origin, whatever else cascaded — and however many hooks fired.
    expect(originKeyOf(store, interaction("b", "Click", 4))).toBe("CartButton");
    expect(originKeyOf(store, interaction("c", "Click", 3))).toBe("SearchBox");
  });

  it("falls back to the label when nothing set state, as on a mount", () => {
    expect(originKeyOf(store, interaction("load", "Load", 5))).toBe("label:Load");
  });

  it("finds the nearest earlier interaction with the same origin", () => {
    const list = [
      interaction("a", "Click", 1, 2),
      interaction("c", "Click", 3),
      interaction("b", "Click", 4),
    ];
    expect(previousComparable(store, list, list[2]!)?.id).toBe("a");
    expect(previousComparable(store, list, list[1]!)).toBe(null);
    expect(previousComparable(store, list, list[0]!)).toBe(null);
  });
});
