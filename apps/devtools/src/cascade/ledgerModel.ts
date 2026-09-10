import { nodeMatchesQuery } from "./search.js";
import { indexCascadeTree, statsFor, type CascadeTree, type SubtreeStats } from "./cascadeTree.js";
import { isUnnamedRender, type CascadeNode, type CascadeProjection } from "./model.js";

/**
 * Ledger projection — the cascade as an indented list instead of a graph.
 *
 * The projection is already a tree (every node has one `parentId`), so depth
 * can be indentation. That is what lets this view window: rows are a fixed
 * height, so only the visible slice is ever built, and a 600-render interaction
 * costs the same as a 30-render one.
 *
 * Pure: plain data in, plain data out, no React and no DOM.
 */

/** @see SubtreeStats — kept as a name the view already speaks. */
export type LedgerSubtree = SubtreeStats;

export interface LedgerRow {
  /** Head of the row. For a folded chain this is the first link. */
  node: CascadeNode;
  /** Tree depth, which is also the indent level. */
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  subtree: LedgerSubtree;
  /** This node matched the query itself, rather than being kept as an ancestor. */
  matched: boolean;
  /**
   * Set when this row stands for a folded pass-through chain: every link from
   * the head to the node where the tree branches again. `null` for a plain row.
   */
  chain: readonly CascadeNode[] | null;
}

export interface LedgerOptions {
  collapsed: ReadonlySet<string>;
  /** Empty string means no filter. */
  query: string;
  /** Fold runs of single-child renders. Defaults to on. */
  foldChains?: boolean;
  /** Chain heads (and their links) the user has expanded. */
  expandedChains?: ReadonlySet<string>;
  /**
   * Show only these node ids (plus the ancestors needed to reach them),
   * intersected with the query. Behaves like a filter: collapse and folding
   * are ignored, because asking for a subset is asking to see it.
   */
  only?: ReadonlySet<string>;
}

/**
 * Shorter runs are not worth a fold: the row would cost as much to read as the
 * two rows it replaces.
 */
const MIN_CHAIN = 3;

/**
 * A single unnamed wrapper is already worth absorbing: it costs a row and a
 * level of indentation and tells the developer nothing.
 */
const MIN_WRAPPER_RUN = 2;

/**
 * A render worth this share of the interaction is never elided into a chain,
 * however deep it sits. Folding must never hide the thing you came to find.
 */
const NEVER_ELIDE_SHARE = 0.05;

/** Ids of every node that matches, plus every ancestor needed to reach one. */
function keptBy(
  index: CascadeTree,
  matches: (node: CascadeNode) => boolean,
): { kept: Set<string>; hits: Set<string> } {
  const kept = new Set<string>();
  const hits = new Set<string>();

  const visit = (node: CascadeNode, trail: CascadeNode[]): boolean => {
    const self = matches(node);
    if (self) hits.add(node.id);
    let any = self;
    const next = [...trail, node];
    for (const child of index.childrenOf.get(node.id) ?? []) any = visit(child, next) || any;
    if (any) for (const ancestor of next) kept.add(ancestor.id);
    return any;
  };

  for (const root of index.childrenOf.get(null) ?? []) visit(root, []);
  return { kept, hits };
}

/** Walk down single-child links from `node` while `extend` accepts the next one. */
function runFrom(
  node: CascadeNode,
  childrenOf: ReadonlyMap<string | null, CascadeNode[]>,
  extend: (next: CascadeNode) => boolean,
): CascadeNode[] {
  const links = [node];
  let current = node;
  for (;;) {
    const children = childrenOf.get(current.id) ?? [];
    if (children.length !== 1) break;
    const next = children[0]!;
    if (!extend(next)) break;
    current = next;
    links.push(current);
  }
  return links;
}

/**
 * The run of renders starting at `node` that can be read as one row.
 *
 * Real trees are mostly spine, and it comes in two flavours, so there are two
 * rules — deliberately not one blended rule, because blending them lets a real
 * component disappear between two wrappers.
 *
 * 1. **Unnamed wrappers.** Component libraries wrap every element in a
 *    `forwardRef(memo(…))` pair React cannot name, so a four-level dialog
 *    arrives eleven levels deep. Those renders have no identity to act on, so
 *    they are absorbed into the row above them however short the run.
 * 2. **A named spine.** Provider → layout → slot → field, each with one child
 *    and the same cause. These are real components, so it takes three of them
 *    before folding pays for itself, and the run stops the moment the cause
 *    changes — one row shows one cause dot, and the cause is the diagnosis.
 *
 * Either way the run stops before an expensive intermediate link, so an
 * expensive render always keeps its own row and its own number.
 */
function chainFrom(
  node: CascadeNode,
  childrenOf: ReadonlyMap<string | null, CascadeNode[]>,
  neverElide: (candidate: CascadeNode) => boolean,
): CascadeNode[] {
  const wrappers = runFrom(node, childrenOf, (next) => isUnnamedRender(next) && !neverElide(next));
  if (wrappers.length >= MIN_WRAPPER_RUN) return wrappers;

  const spine = runFrom(node, childrenOf, (next) => next.cause === node.cause && !neverElide(next));
  return spine.length >= MIN_CHAIN ? spine : [node];
}

/**
 * Flatten the cascade into the exact list of rows the viewport can show.
 * Filtering deliberately ignores `collapsed` and chain folding: asking for a
 * filter is asking to see the hits, and both would hide them.
 */
export function buildLedgerRows(
  projection: CascadeProjection,
  options: LedgerOptions,
): LedgerRow[] {
  const index = indexCascadeTree(projection);
  const query = options.query.trim();
  const only = options.only ?? null;
  const filter =
    query === "" && only === null
      ? null
      : keptBy(
          index,
          (node) =>
            (only === null || only.has(node.id)) && (query === "" || nodeMatchesQuery(node, query)),
        );
  const expandedChains = options.expandedChains ?? EMPTY;
  const folding = (options.foldChains ?? true) && filter === null;
  const hotFloor = projection.totalSelfTime * NEVER_ELIDE_SHARE;
  const neverElide = (node: CascadeNode): boolean => node.selfDuration >= hotFloor;
  const rows: LedgerRow[] = [];

  const walk = (node: CascadeNode, depth: number): void => {
    if (filter && !filter.kept.has(node.id)) return;

    const links =
      folding && !expandedChains.has(node.id)
        ? chainFrom(node, index.childrenOf, neverElide)
        : [node];
    const folded = links.length > 1;
    const tail = folded ? links[links.length - 1]! : node;
    const children = index.childrenOf.get(tail.id) ?? [];
    const collapsed = filter === null && options.collapsed.has(node.id);

    rows.push({
      node,
      depth,
      hasChildren: children.length > 0,
      collapsed,
      subtree: statsFor(index, node),
      matched: filter === null ? true : filter.hits.has(node.id),
      chain: folded ? links : null,
    });

    if (collapsed) return;
    for (const child of children) walk(child, depth + 1);
  };

  for (const root of index.childrenOf.get(null) ?? []) walk(root, 0);
  return rows;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Index of the row showing `id`, or -1 when it is not visible. A node inside a
 * folded chain resolves to the row that stands for that chain.
 */
export function ledgerRowIndex(rows: readonly LedgerRow[], id: string | null): number {
  if (id === null) return -1;
  return rows.findIndex(
    (row) => row.node.id === id || (row.chain?.some((link) => link.id === id) ?? false),
  );
}

/** Every id in a row's chain — what "expand this chain" has to unlock. */
export function chainIds(row: LedgerRow): string[] {
  return (row.chain ?? []).map((link) => link.id);
}

/**
 * Every id with children — what "collapse all" collapses. Roots stay open so
 * the view never goes blank.
 */
export function collapsibleIds(projection: CascadeProjection): Set<string> {
  const index = indexCascadeTree(projection);
  const ids = new Set<string>();
  for (const [parent, children] of index.childrenOf) {
    if (parent === null || children.length === 0) continue;
    ids.add(parent);
  }
  for (const root of index.childrenOf.get(null) ?? []) ids.delete(root.id);
  return ids;
}

/**
 * The render of `node`'s owner in this interaction, so ⤿ Owner can jump to it.
 * The owner's render in the same commit is the one that produced the props;
 * any other render of it is the fallback. `null` when the owner is unknown or
 * did not render here — the marker still names it, it just cannot travel.
 */
export function ownerNodeOf(projection: CascadeProjection, node: CascadeNode): CascadeNode | null {
  if (node.ownerId === null) return null;
  let fallback: CascadeNode | null = null;
  for (const candidate of projection.nodes) {
    if (candidate.kind !== "render" || candidate.componentId !== node.ownerId) continue;
    if (candidate.commitId === node.commitId) return candidate;
    fallback ??= candidate;
  }
  return fallback;
}

/** Ids from `id`'s parent up to its root — what a reveal has to un-collapse. */
export function ancestorIds(projection: CascadeProjection, id: string): string[] {
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const out: string[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current !== null && byId.has(current) && !out.includes(current)) {
    out.push(current);
    current = byId.get(current)!.parentId;
  }
  return out;
}
