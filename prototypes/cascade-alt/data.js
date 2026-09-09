/**
 * Synthetic cascade projections shaped exactly like the real one:
 * `{ id, name, parentId, cause, selfDuration, depth }` — see
 * `apps/devtools/src/cascade/model.ts`.
 *
 * Two datasets on purpose. The small one mirrors the marketing-site interaction
 * in the current Cascade screenshot; the large one is the case the node-link
 * canvas cannot draw at all and is the reason the projection already defends
 * itself with `maxVisibleNodes: 1200`.
 */

export const CAUSES = ["state", "props", "context", "parent", "mount"];

export const CAUSE_LABEL = {
  state: "state",
  props: "props",
  context: "context",
  parent: "parent",
  mount: "mount",
};

/** Why this node rendered, in the inspector's voice. */
export const CAUSE_STORY = {
  state: "its own state changed",
  props: "a prop changed identity",
  context: "a context value changed",
  parent: "its parent re-rendered",
  mount: "it mounted for the first time",
};

const SITE = [
  ["App", null, "state", 0.14],
  ["SiteNav", "App", "parent", 0.11],
  ["Coachmark", "App", "parent", 0.09],
  ["Hero", "App", "parent", 0.04],
  ["Reveal", "App", "context", 0.03],
  ["Reveal", "App", "context", 0.03],
  ["Reveal", "App", "context", 0.02],
  ["Reveal", "App", "context", 0.03],
  ["Reveal", "App", "context", 0.02],
  ["Reveal", "App", "context", 0.03],
  ["Reveal", "App", "context", 0.02],
  ["ThemeToggle", "SiteNav", "parent", 0.03],
  ["IconGitHub", "SiteNav", "parent", 0.01],
  ["IconLens", "SiteNav", "parent", 0.12],
  ["IconSun", "ThemeToggle", "parent", 0.01],
  ["Svg", "ThemeToggle", "parent", 0.01],
  ["Svg", "IconGitHub", "parent", 0.01],
  ["IconLens", "Coachmark", "parent", 0.02],
  ["TimeTravelSection", "Reveal#0", "parent", 0.62],
  ["WhySection", "Reveal#1", "parent", 0.05],
  ["CascadeSection", "Reveal#2", "parent", 0.18],
  ["ChangeSection", "Reveal#3", "parent", 0.04],
  ["Features", "App", "parent", 0.21],
  ["AgentsSection", "App", "parent", 0.16],
  ["TimeMachineSpecimen", "TimeTravelSection", "props", 1.94],
  ["CauseSpecimen", "WhySection", "props", 0.07],
  ["DiffSpecimen", "ChangeSection", "props", 0.06],
  ["Consumer", "TimeMachineSpecimen", "context", 0.03],
  ["Consumer", "TimeMachineSpecimen", "context", 0.02],
  ["Consumer", "TimeMachineSpecimen", "context", 0.02],
  ["Consumer", "TimeMachineSpecimen", "context", 0.02],
  ["Consumer", "CauseSpecimen", "context", 0.02],
  ["Consumer", "DiffSpecimen", "context", 0.02],
];

/** Deterministic LCG — prototypes must render identically on every reload. */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/**
 * A 609-render list interaction: one setState at the top, a 200-row table that
 * did not memoize, two cells per row. This is the shape that makes a node-link
 * graph useless and a folded list trivial.
 */
function buildBigList() {
  const rows = [];
  const r = rng(7);
  const push = (name, parent, cause, self) => rows.push([name, parent, cause, self]);
  push("App", null, "state", 0.18);
  push("Shell", "App", "parent", 0.09);
  push("Toolbar", "Shell", "parent", 0.14);
  push("SearchField", "Toolbar", "props", 0.21);
  push("FilterMenu", "Toolbar", "parent", 0.06);
  push("SortMenu", "Toolbar", "parent", 0.05);
  push("DataTable", "Shell", "props", 1.42);
  for (let i = 0; i < 200; i++) push("Row", "DataTable", "parent", 0.02 + r() * 0.06);
  for (let i = 0; i < 200; i++) push("NameCell", `Row#${i}`, "parent", 0.01 + r() * 0.02);
  for (let i = 0; i < 200; i++) push("StatusBadge", `Row#${i}`, "context", 0.01 + r() * 0.03);
  push("Pagination", "Shell", "parent", 0.07);
  push("StatusBar", "Shell", "context", 0.04);
  return rows;
}

export const DATASETS = [
  { id: "site", label: "Marketing site", hint: "33 renders · the current screenshot", rows: SITE },
  {
    id: "biglist",
    label: "Big list",
    hint: "609 renders · what the graph cannot draw",
    rows: buildBigList(),
  },
];

/**
 * Resolve `"Name"` / `"Name#index"` parent refs into ids, then derive depth,
 * subtree cost and leaf counts in one bottom-up pass.
 */
export function buildProjection(rows) {
  const nodes = rows.map(([name, parentRef, cause, selfDuration], i) => ({
    id: `n${i}`,
    name,
    parentRef,
    cause,
    selfDuration,
    order: i,
    children: [],
  }));

  const byName = new Map();
  for (const n of nodes) {
    const list = byName.get(n.name);
    if (list) list.push(n.id);
    else byName.set(n.name, [n.id]);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const n of nodes) {
    if (n.parentRef == null) {
      n.parentId = null;
      continue;
    }
    const [name, idx] = n.parentRef.split("#");
    const list = byName.get(name) ?? [];
    const resolved = list[idx === undefined ? 0 : Number(idx)];
    if (resolved === undefined) throw new Error(`unresolved parent ref: ${n.parentRef}`);
    n.parentId = resolved;
  }

  for (const n of nodes) if (n.parentId != null) byId.get(n.parentId).children.push(n);

  const roots = nodes.filter((n) => n.parentId == null);

  // Interned subtree shapes. Two siblings may only fold into one `×N` row when
  // their whole subtree is identical — otherwise folding hides real structure.
  const shapes = new Map();
  const intern = (key) => {
    const known = shapes.get(key);
    if (known !== undefined) return known;
    const id = shapes.size;
    shapes.set(key, id);
    return id;
  };

  // Iterative post-order: 600+ nodes is fine recursively, but depth is data.
  for (const root of roots) {
    const stack = [[root, 0]];
    const order = [];
    while (stack.length > 0) {
      const [node, depth] = stack.pop();
      node.depth = depth;
      order.push(node);
      for (const c of node.children) stack.push([c, depth + 1]);
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      n.totalDuration = n.selfDuration + n.children.reduce((s, c) => s + c.totalDuration, 0);
      n.subtreeCount = 1 + n.children.reduce((s, c) => s + c.subtreeCount, 0);
      n.leafCount = n.children.length === 0 ? 1 : n.children.reduce((s, c) => s + c.leafCount, 0);
      n.shape = intern(`${n.name}:${n.cause}(${n.children.map((c) => c.shape).join(",")})`);
    }
  }

  const totalSelf = nodes.reduce((s, n) => s + n.selfDuration, 0);
  return {
    nodes,
    byId,
    roots,
    totalSelf,
    maxSelf: Math.max(...nodes.map((n) => n.selfDuration)),
    maxTotal: Math.max(...nodes.map((n) => n.totalDuration)),
    maxDepth: Math.max(...nodes.map((n) => n.depth)),
    componentCount: byName.size,
  };
}

/** Ancestors of `id`, root first, inclusive. */
export function chainOf(projection, id) {
  const chain = [];
  for (let n = projection.byId.get(id); n; n = n.parentId ? projection.byId.get(n.parentId) : null)
    chain.unshift(n);
  return chain;
}
