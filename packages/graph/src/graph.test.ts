import { describe, it, expect } from "vitest";
import { buildGraph } from "./build.js";
import { focus, neighbors } from "./focus.js";
import { componentKey, contextKey } from "./types.js";
import type { ComponentId, ComponentType } from "@react-lens/protocol";

const cid = (n: number) => n as ComponentId;
const ctid = (n: number) => n as ComponentType;

describe("buildGraph", () => {
  it("creates component nodes and ownership edges", () => {
    const g = buildGraph({
      components: [
        { id: cid(1), name: "App" },
        { id: cid(2), name: "Grid", parentId: cid(1) },
      ],
    });
    expect(g.nodes.size).toBe(2);
    expect(g.edges).toContainEqual({
      from: componentKey(cid(2)),
      to: componentKey(cid(1)),
      kind: "parent",
      confidence: 1,
    });
  });

  it("adds causality edges from parent render reasons", () => {
    const g = buildGraph({
      components: [
        { id: cid(1), name: "Grid" },
        { id: cid(2), name: "Card", parentId: cid(1) },
      ],
      renders: [{ componentId: cid(2), reasons: [{ type: "parent", componentId: cid(1) }] }],
    });
    expect(g.edges.some((e) => e.kind === "renders" && e.from === componentKey(cid(1)))).toBe(true);
  });

  it("adds a context node and reads-context edge", () => {
    const g = buildGraph({
      components: [{ id: cid(2), name: "Card" }],
      renders: [
        { componentId: cid(2), reasons: [{ type: "context", contextType: ctid(9), label: "CartContext" }] },
      ],
    });
    expect(g.nodes.get(contextKey(ctid(9)))?.label).toBe("CartContext");
    expect(g.edges.some((e) => e.kind === "reads-context")).toBe(true);
  });

  it("deduplicates repeated edges", () => {
    const g = buildGraph({
      components: [
        { id: cid(1), name: "Grid" },
        { id: cid(2), name: "Card", parentId: cid(1) },
      ],
      renders: [
        { componentId: cid(2), reasons: [{ type: "parent", componentId: cid(1) }] },
        { componentId: cid(2), reasons: [{ type: "parent", componentId: cid(1) }] },
      ],
    });
    expect(g.edges.filter((e) => e.kind === "renders").length).toBe(1);
  });
});

describe("focus / neighbors", () => {
  const g = buildGraph({
    components: [
      { id: cid(1), name: "App" },
      { id: cid(2), name: "Grid", parentId: cid(1) },
      { id: cid(3), name: "Card", parentId: cid(2) },
      { id: cid(4), name: "Footer", parentId: cid(1) },
    ],
  });

  it("returns in/out neighbors", () => {
    const n = neighbors(g, componentKey(cid(2)));
    // Grid's parent edge points to App (outgoing); Card's parent edge points to Grid (incoming).
    expect(n.outgoing.some((e) => e.to === componentKey(cid(1)))).toBe(true);
    expect(n.incoming.some((e) => e.from === componentKey(cid(3)))).toBe(true);
  });

  it("focus(depth=1) keeps only direct neighbors", () => {
    const sub = focus(g, componentKey(cid(2)), 1);
    // Grid + App + Card, but not Footer.
    expect(sub.nodes.has(componentKey(cid(2)))).toBe(true);
    expect(sub.nodes.has(componentKey(cid(1)))).toBe(true);
    expect(sub.nodes.has(componentKey(cid(3)))).toBe(true);
    expect(sub.nodes.has(componentKey(cid(4)))).toBe(false);
  });

  it("focus(depth=2) expands one more hop", () => {
    const sub = focus(g, componentKey(cid(3)), 2);
    // Card -> Grid -> App reachable in 2 hops.
    expect(sub.nodes.has(componentKey(cid(1)))).toBe(true);
  });
});
