import { describe, it, expect } from "vite-plus/test";
import { buildTree } from "./build.js";
import { flatten } from "./flatten.js";
import type { ComponentDatum, GroupNode, ComponentNode } from "./types.js";
import type { ComponentId } from "@reactlens/protocol";

let seq = 0;
function datum(
  name: string,
  parentId: number | undefined,
  over: Partial<ComponentDatum> = {},
): ComponentDatum {
  return {
    id: ++seq as ComponentId,
    name,
    parentId: parentId as ComponentId | undefined,
    renders: 1,
    selfTime: 1,
    compiled: false,
    ...over,
  };
}

describe("buildTree — ownership", () => {
  it("nests children under parents and roots orphans", () => {
    seq = 0;
    const app = datum("App", undefined); // id 1
    const grid = datum("ProductGrid", 1); // id 2
    const roots = buildTree([app, grid], { group: false });
    expect(roots).toHaveLength(1);
    const appNode = roots[0] as ComponentNode;
    expect(appNode.datum.name).toBe("App");
    expect(appNode.children).toHaveLength(1);
    expect((appNode.children[0] as ComponentNode).datum.name).toBe("ProductGrid");
  });
});

describe("buildTree — grouping", () => {
  it("compresses repeated siblings into a group with summed telemetry", () => {
    seq = 0;
    const app = datum("App", undefined); // 1
    const cards = [1, 2, 3, 4, 5].map(() =>
      datum("Card", 1, { renders: 4, selfTime: 2, observableChange: false }),
    );
    const roots = buildTree([app, ...cards]);
    const appNode = roots[0] as ComponentNode;
    expect(appNode.children).toHaveLength(1);
    const group = appNode.children[0] as GroupNode;
    expect(group.kind).toBe("group");
    expect(group.count).toBe(5);
    expect(group.renders).toBe(20);
    expect(group.selfTime).toBe(10);
    expect(group.suspicious).toBe(5);
  });

  it("does not group below the threshold", () => {
    seq = 0;
    const app = datum("App", undefined);
    const two = [datum("Card", 1), datum("Card", 1)];
    const roots = buildTree([app, ...two], { groupThreshold: 3 });
    const appNode = roots[0] as ComponentNode;
    expect(appNode.children.every((c) => c.kind === "component")).toBe(true);
  });
});

describe("buildTree — projection filter", () => {
  it("keeps matches and their ancestors, drops the rest", () => {
    seq = 0;
    const app = datum("App", undefined); // 1
    const grid = datum("ProductGrid", 1); // 2
    const footer = datum("Footer", 1); // 3
    const card = datum("Card", 2, { observableChange: false }); // 4
    const roots = buildTree([app, grid, footer, card], {
      group: false,
      include: (d) => d.observableChange === false,
    });
    // App → ProductGrid → Card kept; Footer dropped.
    const appNode = roots[0] as ComponentNode;
    expect(appNode.children).toHaveLength(1);
    expect((appNode.children[0] as ComponentNode).datum.name).toBe("ProductGrid");
    expect(
      appNode.children.find((c) => (c as ComponentNode).datum?.name === "Footer"),
    ).toBeUndefined();
  });
});

describe("flatten", () => {
  it("only descends expanded branches", () => {
    seq = 0;
    const app = datum("App", undefined); // 1
    const grid = datum("ProductGrid", 1); // 2
    const card = datum("Card", 2); // 3
    const roots = buildTree([app, grid, card], { group: false });

    const collapsed = flatten(roots, new Set());
    expect(collapsed.map((r) => r.node.kind === "component" && r.node.datum.name)).toEqual(["App"]);

    const expanded = flatten(roots, new Set(["c:1", "c:2"]));
    expect(expanded).toHaveLength(3);
    expect(expanded[2]?.depth).toBe(2);
  });

  it("marks groups expandable and reveals instances when expanded", () => {
    seq = 0;
    const app = datum("App", undefined);
    const cards = [1, 2, 3].map(() => datum("Card", 1));
    const roots = buildTree([app, ...cards]);
    const expanded = flatten(roots, new Set(["c:1"]));
    const groupRow = expanded.find((r) => r.node.kind === "group");
    expect(groupRow?.expandable).toBe(true);

    const groupKey = groupRow!.key;
    const withInstances = flatten(roots, new Set(["c:1", groupKey]));
    const instanceRows = withInstances.filter((r) => r.node.kind === "component" && r.depth === 2);
    expect(instanceRows).toHaveLength(3);
  });
});
