import { describe, expect, it } from "vite-plus/test";
import type { CommitId, ComponentId, RenderId } from "@reactlens/protocol";
import type { CascadeCause, CascadeNode, CascadeProjection } from "./model.js";
import { buildRollup, sortRollup } from "./rollupModel.js";

let seq = 0;

function node(
  id: string,
  name: string,
  parentId: string | null,
  depth: number,
  cause: CascadeCause,
  selfDuration: number,
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
    duration: selfDuration,
    selfDuration,
    depth,
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

function projectionFixture(): CascadeProjection {
  const nodes: CascadeNode[] = [
    node("app", "App", null, 0, "state", 0.2, { childCount: 2 }),
    node("table", "DataTable", "app", 1, "props", 8, { childCount: 1 }),
    node("rows", "Row ×4", "table", 2, "parent", 0.08, {
      kind: "aggregate",
      aggregateCount: 4,
      renderIds: [90, 91, 92, 93] as unknown as readonly RenderId[],
    }),
    node("badge1", "Badge", "app", 1, "context", 0.01),
    node("badge2", "Badge", "app", 1, "context", 0.01),
    node("badge3", "Badge", "app", 1, "context", 0.01),
  ];
  return {
    interaction: { id: "i1", start: 0, end: 10 } as CascadeProjection["interaction"],
    nodes,
    edges: [],
    roots: ["app"],
    totalRenderCount: 10,
    totalSelfTime: 8.31,
    maxDepth: 2,
    aggregatedRenderCount: 4,
  };
}

describe("buildRollup", () => {
  it("collapses render instances into one row per component", () => {
    const rows = buildRollup(projectionFixture());
    expect(rows.map((row) => row.name).sort()).toEqual(["App", "Badge", "DataTable", "Row"]);
  });

  it("strips the aggregate suffix and counts its members", () => {
    const row = buildRollup(projectionFixture()).find((r) => r.name === "Row")!;
    expect(row.renderCount).toBe(4);
  });

  it("sums self time and reports the share of the interaction", () => {
    const row = buildRollup(projectionFixture()).find((r) => r.name === "DataTable")!;
    expect(row.selfTime).toBeCloseTo(8);
    expect(row.share).toBeCloseTo(8 / 8.31);
  });

  it("reports the depth span a component rendered at", () => {
    const badge = buildRollup(projectionFixture()).find((r) => r.name === "Badge")!;
    expect([badge.minDepth, badge.maxDepth]).toEqual([1, 1]);
  });

  it("counts the causes so the view can draw a mix bar", () => {
    const badge = buildRollup(projectionFixture()).find((r) => r.name === "Badge")!;
    expect(badge.causes.get("context")).toBe(3);
    expect(badge.dominantCause).toBe("context");
  });

  it("calls the dominant cost hot", () => {
    const row = buildRollup(projectionFixture()).find((r) => r.name === "DataTable")!;
    expect(row.verdict.tone).toBe("hot");
  });

  it("calls a repeatedly-cascaded component with no work of its own a passenger", () => {
    const row = buildRollup(projectionFixture()).find((r) => r.name === "Badge")!;
    expect(row.verdict.tone).toBe("passenger");
  });

  it("does not call the root cause a passenger", () => {
    const row = buildRollup(projectionFixture()).find((r) => r.name === "App")!;
    expect(row.verdict.tone).not.toBe("passenger");
  });

  it("offers the costliest instance as the drill-down anchor", () => {
    const row = buildRollup(projectionFixture()).find((r) => r.name === "Badge")!;
    expect(["badge1", "badge2", "badge3"]).toContain(row.anchorId);
  });

  it("does not divide by zero on an interaction that cost nothing", () => {
    const projection = projectionFixture();
    projection.nodes = projection.nodes.map((n) => ({ ...n, selfDuration: 0 }) as CascadeNode);
    projection.totalSelfTime = 0;
    for (const row of buildRollup(projection)) expect(row.share).toBe(0);
  });
});

describe("buildRollup — compiler status", () => {
  function mixedFixture(): CascadeProjection {
    const nodes: CascadeNode[] = [
      node("a", "Row", null, 1, "parent", 1, { compiled: true }),
      node("b", "Row", null, 1, "parent", 1, { compiled: false }),
      node("c", "Row", null, 1, "parent", 1, { compiled: true }),
      node("d", "Card", null, 1, "parent", 1, { compiled: true }),
      node("e", "Card", null, 1, "parent", 1, { compiled: true }),
      node("f", "Ghost", null, 1, "parent", 1, { compiled: null }),
    ];
    return {
      interaction: { id: "i1", start: 0, end: 10 } as CascadeProjection["interaction"],
      nodes,
      edges: [],
      roots: [],
      totalRenderCount: nodes.length,
      totalSelfTime: nodes.length,
      maxDepth: 1,
      aggregatedRenderCount: 0,
    };
  }

  it("counts how many of a component's renders were compiled", () => {
    const rows = buildRollup(mixedFixture());
    const row = rows.find((r) => r.name === "Row")!;
    expect([row.compiledCount, row.compilerKnownCount]).toEqual([2, 3]);
  });

  it("reports a fully compiled component as such", () => {
    const row = buildRollup(mixedFixture()).find((r) => r.name === "Card")!;
    expect(row.compiledCount).toBe(2);
    expect(row.compilerKnownCount).toBe(2);
  });

  it("claims nothing when the runtime reported no status", () => {
    const row = buildRollup(mixedFixture()).find((r) => r.name === "Ghost")!;
    expect(row.compilerKnownCount).toBe(0);
  });
});

describe("buildRollup — flagged components", () => {
  function flaggedFixture(): CascadeProjection {
    const nodes: CascadeNode[] = [
      node("a", "Row", null, 1, "parent", 1, { componentId: 7 as never }),
      node("b", "Row", null, 1, "parent", 1, { componentId: 8 as never }),
      node("c", "Card", null, 1, "parent", 1, { componentId: 9 as never }),
    ];
    return {
      interaction: { id: "i1", start: 0, end: 10 } as CascadeProjection["interaction"],
      nodes,
      edges: [],
      roots: [],
      totalRenderCount: nodes.length,
      totalSelfTime: nodes.length,
      maxDepth: 1,
      aggregatedRenderCount: 0,
    };
  }

  it("flags a component when the doctor flagged any of its instances", () => {
    const rows = buildRollup(flaggedFixture(), new Set([8 as never]));
    expect(rows.find((r) => r.name === "Row")!.flagged).toBe(true);
    expect(rows.find((r) => r.name === "Card")!.flagged).toBe(false);
  });

  it("flags nothing when the doctor has found nothing", () => {
    const rows = buildRollup(flaggedFixture());
    expect(rows.every((r) => !r.flagged)).toBe(true);
  });
});

describe("sortRollup", () => {
  it("sorts by self time descending by default", () => {
    const rows = sortRollup(buildRollup(projectionFixture()), { key: "selfTime", dir: "desc" });
    expect(rows[0]!.name).toBe("DataTable");
  });

  it("reverses on ascending", () => {
    const rows = sortRollup(buildRollup(projectionFixture()), { key: "selfTime", dir: "asc" });
    expect(rows[rows.length - 1]!.name).toBe("DataTable");
  });

  it("sorts by name alphabetically", () => {
    const rows = sortRollup(buildRollup(projectionFixture()), { key: "name", dir: "asc" });
    expect(rows.map((row) => row.name)).toEqual(["App", "Badge", "DataTable", "Row"]);
  });

  it("breaks ties by name so the order never flickers", () => {
    const rows = sortRollup(buildRollup(projectionFixture()), { key: "renderCount", dir: "desc" });
    const ones = rows.filter((row) => row.renderCount === 1).map((row) => row.name);
    expect(ones).toEqual([...ones].sort());
  });
});
