import { describe, expect, it } from "vite-plus/test";
import type { CascadeNode } from "./model.js";
import {
  buildCascadeSearchIndex,
  matchCascadeNodes,
  nodeMatchesQuery,
  queryCascadeSearchIndex,
} from "./search.js";

function node(partial: Partial<CascadeNode> & Pick<CascadeNode, "id" | "name">): CascadeNode {
  return {
    kind: "render",
    renderId: 1 as CascadeNode["renderId"],
    renderIds: [],
    componentId: 1 as CascadeNode["componentId"],
    commitId: 1 as CascadeNode["commitId"],
    cause: "state",
    timestamp: 0,
    duration: 1,
    selfDuration: 1,
    depth: 0,
    parentId: null,
    childCount: 0,
    aggregateCount: 1,
    ...partial,
  } as CascadeNode;
}

describe("cascade search", () => {
  it("matches names case-insensitively", () => {
    expect(nodeMatchesQuery(node({ id: "r:1", name: "ProductCard" }), "product")).toBe(true);
    expect(nodeMatchesQuery(node({ id: "r:1", name: "ProductCard" }), "CARD")).toBe(true);
    expect(nodeMatchesQuery(node({ id: "r:1", name: "ProductCard" }), "xyz")).toBe(false);
  });

  it("matches parent-caused nodes as cascade or parent", () => {
    const list = node({ id: "r:1", name: "List", cause: "parent" });
    expect(nodeMatchesQuery(list, "cascade")).toBe(true);
    expect(nodeMatchesQuery(list, "parent")).toBe(true);
    expect(nodeMatchesQuery(node({ id: "r:1", name: "List", cause: "state" }), "state")).toBe(true);
  });

  it("ANDs space-separated tokens", () => {
    const card = node({ id: "r:1", name: "ProductCard", cause: "props" });
    expect(nodeMatchesQuery(card, "product props")).toBe(true);
    expect(nodeMatchesQuery(card, "product state")).toBe(false);
  });

  it("does not match an empty query — search is opt-in", () => {
    expect(nodeMatchesQuery(node({ id: "r:1", name: "App" }), "")).toBe(false);
    expect(nodeMatchesQuery(node({ id: "r:1", name: "App" }), "   ")).toBe(false);
    expect(matchCascadeNodes([node({ id: "r:1", name: "App" })], "")).toEqual([]);
  });

  it("keeps the input order so next/prev walks the laid-out graph", () => {
    const nodes = [
      node({ id: "r:1", name: "App" }),
      node({ id: "r:2", name: "ProductList" }),
      node({ id: "r:3", name: "ProductCard" }),
    ];
    expect(matchCascadeNodes(nodes, "product").map((n) => n.id)).toEqual(["r:2", "r:3"]);
  });

  it("matches aggregate nodes by name and the aggregate token", () => {
    const group = node({
      id: "g:1",
      name: "ProductCard ×7",
      kind: "aggregate",
      aggregateCount: 7,
    });
    expect(nodeMatchesQuery(group, "productcard")).toBe(true);
    expect(nodeMatchesQuery(group, "aggregate")).toBe(true);
  });

  it("agrees with a linear scan after the index is built once", () => {
    const nodes = [
      node({ id: "r:1", name: "App", cause: "mount" }),
      node({ id: "r:2", name: "ProductList", cause: "parent" }),
      node({ id: "r:3", name: "ProductCard", cause: "props" }),
      node({ id: "r:4", name: "CartButton", cause: "state" }),
      node({
        id: "g:1",
        name: "ProductCard ×7",
        kind: "aggregate",
        aggregateCount: 7,
      }),
    ];
    const index = buildCascadeSearchIndex(nodes);
    for (const query of ["", "product", "card", "state", "product props", "xyz", "cascade"]) {
      expect(queryCascadeSearchIndex(index, query).map((n) => n.id)).toEqual(
        nodes.filter((n) => nodeMatchesQuery(n, query)).map((n) => n.id),
      );
    }
  });
});
