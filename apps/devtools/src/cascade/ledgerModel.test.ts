import { describe, expect, it } from "vite-plus/test";
import type { CommitId, ComponentId, RenderId } from "@reactlens/protocol";
import type { CascadeCause, CascadeNode, CascadeProjection } from "./model.js";
import { buildLedgerRows, ledgerRowIndex } from "./ledgerModel.js";

let seq = 0;

function node(
  id: string,
  parentId: string | null,
  depth: number,
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
    name: id,
    cause: "parent" as CascadeCause,
    timestamp: seq,
    duration: 1,
    selfDuration: 1,
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

/**
 *  App
 *  ├─ Nav ── Icon
 *  └─ List ── Row ×4 (aggregate)
 */
function projectionFixture(): CascadeProjection {
  const nodes: CascadeNode[] = [
    node("App", null, 0, { name: "App", cause: "state", selfDuration: 2, childCount: 2 }),
    node("Nav", "App", 1, { name: "Nav", childCount: 1, selfDuration: 1 }),
    node("Icon", "Nav", 2, { name: "Icon", selfDuration: 0.5 }),
    node("List", "App", 1, { name: "List", cause: "props", childCount: 1, selfDuration: 4 }),
    node("Rows", "List", 2, {
      kind: "aggregate",
      name: "Row ×4",
      selfDuration: 0.8,
      aggregateCount: 4,
    }),
  ];
  return {
    interaction: { id: "i1", start: 0, end: 10 } as CascadeProjection["interaction"],
    nodes,
    edges: [],
    roots: ["App"],
    totalRenderCount: 8,
    totalSelfTime: 8.3,
    maxDepth: 2,
    aggregatedRenderCount: 4,
  };
}

const NO_FILTER = { collapsed: new Set<string>(), query: "" };

describe("buildLedgerRows", () => {
  it("flattens the tree depth-first in reading order", () => {
    const rows = buildLedgerRows(projectionFixture(), NO_FILTER);
    expect(rows.map((row) => row.node.id)).toEqual(["App", "Nav", "Icon", "List", "Rows"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 2]);
  });

  it("counts aggregate members in the subtree render count", () => {
    const rows = buildLedgerRows(projectionFixture(), NO_FILTER);
    const byId = new Map(rows.map((row) => [row.node.id, row]));
    // App + Nav + Icon + List + 4 rows = 8
    expect(byId.get("App")!.subtree.renderCount).toBe(8);
    expect(byId.get("List")!.subtree.renderCount).toBe(5);
    expect(byId.get("Rows")!.subtree.renderCount).toBe(4);
  });

  it("sums self time over the whole subtree", () => {
    const rows = buildLedgerRows(projectionFixture(), NO_FILTER);
    const byId = new Map(rows.map((row) => [row.node.id, row]));
    expect(byId.get("List")!.subtree.selfTime).toBeCloseTo(4.8);
    expect(byId.get("App")!.subtree.selfTime).toBeCloseTo(8.3);
  });

  it("hides descendants of a collapsed node but keeps the node", () => {
    const rows = buildLedgerRows(projectionFixture(), {
      ...NO_FILTER,
      collapsed: new Set(["Nav"]),
    });
    expect(rows.map((row) => row.node.id)).toEqual(["App", "Nav", "List", "Rows"]);
    expect(rows.find((row) => row.node.id === "Nav")!.collapsed).toBe(true);
  });

  it("marks rows that have children so the view can draw a twisty", () => {
    const rows = buildLedgerRows(projectionFixture(), NO_FILTER);
    const byId = new Map(rows.map((row) => [row.node.id, row]));
    expect(byId.get("App")!.hasChildren).toBe(true);
    expect(byId.get("Icon")!.hasChildren).toBe(false);
    expect(byId.get("Rows")!.hasChildren).toBe(false);
  });

  it("keeps the ancestors of a filter hit, and marks who actually matched", () => {
    const rows = buildLedgerRows(projectionFixture(), { ...NO_FILTER, query: "icon" });
    expect(rows.map((row) => row.node.id)).toEqual(["App", "Nav", "Icon"]);
    expect(rows.map((row) => row.matched)).toEqual([false, false, true]);
  });

  it("ignores collapse while filtering — a filter is a request to see the hits", () => {
    const rows = buildLedgerRows(projectionFixture(), {
      collapsed: new Set(["Nav"]),
      query: "icon",
    });
    expect(rows.map((row) => row.node.id)).toEqual(["App", "Nav", "Icon"]);
  });

  it("returns no rows when nothing matches", () => {
    expect(buildLedgerRows(projectionFixture(), { ...NO_FILTER, query: "zzz" })).toEqual([]);
  });

  it("survives a parentId that is not in the projection", () => {
    const projection = projectionFixture();
    projection.nodes = projection.nodes.map((n) =>
      n.id === "Nav" ? ({ ...n, parentId: "ghost" } as CascadeNode) : n,
    );
    const rows = buildLedgerRows(projection, NO_FILTER);
    // Nav is re-rooted rather than dropped: an orphan render is still a render.
    expect(rows.map((row) => row.node.id).sort()).toEqual(["App", "Icon", "List", "Nav", "Rows"]);
  });
});

/**
 * The shape real apps produce: a long spine of single-child wrapper renders
 * before anything interesting branches.
 *
 *  App ── W0 ── W1 ── W2 ── W3 ── W4 ─┬─ LeafA
 *                                     └─ LeafB
 */
function spineFixture(hotIndex = -1): CascadeProjection {
  const nodes: CascadeNode[] = [
    node("App", null, 0, { name: "App", cause: "state", selfDuration: 1 }),
  ];
  let parent = "App";
  for (let i = 0; i < 5; i++) {
    // Wrappers do essentially no work of their own — that is what makes them
    // wrappers, and what makes eliding them safe.
    nodes.push(
      node(`W${i}`, parent, i + 1, {
        name: `W${i}`,
        selfDuration: i === hotIndex ? 40 : 0.01,
        childCount: 1,
      }),
    );
    parent = `W${i}`;
  }
  nodes.push(node("LeafA", parent, 6, { name: "LeafA", selfDuration: 0.01 }));
  nodes.push(node("LeafB", parent, 6, { name: "LeafB", selfDuration: 0.01 }));
  return {
    interaction: { id: "i1", start: 0, end: 10 } as CascadeProjection["interaction"],
    nodes,
    edges: [],
    roots: ["App"],
    totalRenderCount: nodes.length,
    totalSelfTime: nodes.reduce((sum, n) => sum + n.selfDuration, 0),
    maxDepth: 6,
    aggregatedRenderCount: 0,
  };
}

describe("buildLedgerRows — pass-through chains", () => {
  it("folds a run of single-child renders into one row", () => {
    const rows = buildLedgerRows(spineFixture(), NO_FILTER);
    // App, the folded W0…W4 spine, then the two leaves.
    expect(rows.map((row) => row.node.id)).toEqual(["App", "W0", "LeafA", "LeafB"]);
  });

  it("reports the folded run so the view can label both ends", () => {
    const rows = buildLedgerRows(spineFixture(), NO_FILTER);
    const chain = rows.find((row) => row.node.id === "W0")!.chain!;
    expect(chain.map((n) => n.id)).toEqual(["W0", "W1", "W2", "W3", "W4"]);
  });

  it("collapses the depth of everything below it", () => {
    const rows = buildLedgerRows(spineFixture(), NO_FILTER);
    // Without folding LeafA sits at depth 6; behind the folded spine it is 2.
    expect(rows.find((row) => row.node.id === "LeafA")!.depth).toBe(2);
  });

  it("never elides an expensive render — it always heads its own row", () => {
    const rows = buildLedgerRows(spineFixture(2), NO_FILTER);
    expect(rows.map((row) => row.node.id)).toContain("W2");
    // And it is never hidden as an intermediate link of somebody else's chain.
    const elided = rows.flatMap((row) => (row.chain ?? []).slice(1).map((link) => link.id));
    expect(elided).not.toContain("W2");
  });

  it("only folds links that share a cause — a context render never hides in a parent spine", () => {
    const projection = spineFixture();
    projection.nodes = projection.nodes.map((n) =>
      n.id === "W2" ? ({ ...n, cause: "context" } as CascadeNode) : n,
    );
    const rows = buildLedgerRows(projection, NO_FILTER);
    expect(rows.map((row) => row.node.id)).toContain("W2");
  });

  it("leaves runs shorter than three links alone", () => {
    const rows = buildLedgerRows(projectionFixture(), NO_FILTER);
    expect(rows.every((row) => row.chain === null)).toBe(true);
  });

  it("expands a chain back into its individual renders on request", () => {
    const rows = buildLedgerRows(spineFixture(), {
      ...NO_FILTER,
      expandedChains: new Set(["W0", "W1", "W2", "W3", "W4"]),
    });
    expect(rows.map((row) => row.node.id)).toEqual([
      "App",
      "W0",
      "W1",
      "W2",
      "W3",
      "W4",
      "LeafA",
      "LeafB",
    ]);
  });

  it("does not fold while filtering — a filter is a request to see the hits", () => {
    const rows = buildLedgerRows(spineFixture(), { ...NO_FILTER, query: "W3" });
    expect(rows.map((row) => row.node.id)).toEqual(["App", "W0", "W1", "W2", "W3"]);
  });

  it("can be turned off entirely", () => {
    const rows = buildLedgerRows(spineFixture(), { ...NO_FILTER, foldChains: false });
    expect(rows).toHaveLength(8);
  });
});

/**
 * What component libraries actually emit: every styled element is a
 * `forwardRef(memo(...))` pair the runtime cannot name, so a four-level dialog
 * arrives eleven levels deep.
 *
 *  Root ─ Backdrop ─ Anon ─ Anon
 *       └ Positioner ─ Anon ─ Anon ─ Content ─┬─ Title
 *                                             └─ Close
 */
function wrapperFixture(): CascadeProjection {
  const nodes: CascadeNode[] = [
    node("root", null, 0, { name: "DialogRoot", cause: "state", selfDuration: 1 }),
    node("backdrop", "root", 1, { name: "Backdrop", cause: "context", selfDuration: 0.01 }),
    node("b1", "backdrop", 2, { name: "Anonymous", cause: "props", selfDuration: 0.01 }),
    node("b2", "b1", 3, { name: "Anonymous", cause: "props", selfDuration: 0.01 }),
    node("pos", "root", 1, { name: "Positioner", cause: "context", selfDuration: 0.01 }),
    node("p1", "pos", 2, { name: "Anonymous", cause: "props", selfDuration: 0.01 }),
    node("p2", "p1", 3, { name: "Anonymous", cause: "props", selfDuration: 0.01 }),
    node("content", "p2", 4, { name: "Content", cause: "context", selfDuration: 0.01 }),
    node("title", "content", 5, { name: "Title", cause: "context", selfDuration: 0.01 }),
    node("close", "content", 5, { name: "Close", cause: "context", selfDuration: 0.01 }),
  ];
  return {
    interaction: { id: "i1", start: 0, end: 10 } as CascadeProjection["interaction"],
    nodes,
    edges: [],
    roots: ["root"],
    totalRenderCount: nodes.length,
    totalSelfTime: nodes.reduce((sum, n) => sum + n.selfDuration, 0),
    maxDepth: 5,
    aggregatedRenderCount: 0,
  };
}

describe("buildLedgerRows — unnamed wrappers", () => {
  it("absorbs the wrappers React could not name into the row above them", () => {
    const rows = buildLedgerRows(wrapperFixture(), NO_FILTER);
    expect(rows.map((row) => row.node.id)).toEqual([
      "root",
      "backdrop",
      "pos",
      "content",
      "title",
      "close",
    ]);
  });

  it("gives the depth back — the dialog reads four levels deep, not six", () => {
    const rows = buildLedgerRows(wrapperFixture(), NO_FILTER);
    const byId = new Map(rows.map((row) => [row.node.id, row]));
    expect(byId.get("content")!.depth).toBe(2);
    expect(byId.get("title")!.depth).toBe(3);
  });

  it("folds a run of one wrapper — a named spine still needs three", () => {
    const projection = wrapperFixture();
    projection.nodes = projection.nodes.filter((n) => n.id !== "b2");
    const rows = buildLedgerRows(projection, NO_FILTER);
    expect(rows.find((row) => row.node.id === "backdrop")!.chain).toHaveLength(2);
  });

  it("never absorbs a named component, even when its cause matches", () => {
    const rows = buildLedgerRows(wrapperFixture(), NO_FILTER);
    const elided = rows.flatMap((row) => (row.chain ?? []).slice(1).map((link) => link.name));
    expect(new Set(elided)).toEqual(new Set(["Anonymous"]));
  });
});

describe("ledgerRowIndex", () => {
  it("finds the row a folded chain member is hiding inside", () => {
    const rows = buildLedgerRows(spineFixture(), NO_FILTER);
    expect(rows[ledgerRowIndex(rows, "W3")]!.node.id).toBe("W0");
  });
});

describe("ledgerRowIndex", () => {
  it("finds the row for an id, and reports -1 when it is not visible", () => {
    const rows = buildLedgerRows(projectionFixture(), NO_FILTER);
    expect(ledgerRowIndex(rows, "List")).toBe(3);
    expect(ledgerRowIndex(rows, "nope")).toBe(-1);
  });
});
