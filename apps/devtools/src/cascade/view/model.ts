import type { Interaction, TraceStore } from "@reactlens/trace-engine";
import type { CommitId, ComponentId, RenderEvent, RenderId } from "@reactlens/protocol";

export type CascadeCause = "state" | "props" | "context" | "parent" | "mount" | "other";

export interface CascadeRenderNode {
  id: string;
  kind: "render";
  renderId: RenderId;
  renderIds: readonly RenderId[];
  componentId: ComponentId;
  commitId: CommitId;
  name: string;
  cause: CascadeCause;
  timestamp: number;
  duration: number;
  selfDuration: number;
  depth: number;
  parentId: string | null;
  childCount: number;
  aggregateCount: 1;
}

export interface CascadeAggregateNode {
  id: string;
  kind: "aggregate";
  renderId: null;
  renderIds: readonly RenderId[];
  componentId: ComponentId | null;
  commitId: CommitId | null;
  name: string;
  cause: CascadeCause;
  timestamp: number;
  duration: number;
  selfDuration: number;
  depth: number;
  parentId: string | null;
  childCount: 0;
  aggregateCount: number;
}

export type CascadeNode = CascadeRenderNode | CascadeAggregateNode;

export interface CascadeEdge {
  id: string;
  from: string;
  to: string;
  order: number;
  cause: CascadeCause;
}

export interface CascadeProjection {
  interaction: Interaction;
  nodes: CascadeNode[];
  edges: CascadeEdge[];
  roots: string[];
  totalRenderCount: number;
  totalSelfTime: number;
  maxDepth: number;
  aggregatedRenderCount: number;
}

export interface CascadeProjectionOptions {
  /** Leaf siblings at/above this count collapse into one aggregate node. */
  aggregateThreshold?: number;
  /** Protect the view/layout from pathological interactions. */
  maxVisibleNodes?: number;
  /** Aggregate groups explicitly expanded by the user. */
  expandedAggregateKeys?: ReadonlySet<string>;
}

const DEFAULT_AGGREGATE_THRESHOLD = 6;
const DEFAULT_MAX_VISIBLE_NODES = 1_200;

function causeOf(render: RenderEvent): CascadeCause {
  for (const reason of render.reasons) {
    switch (reason.type) {
      case "state":
        return "state";
      case "props":
        return "props";
      case "context":
        return "context";
      case "parent":
        return "parent";
      case "mount":
        return "mount";
      default:
        break;
    }
  }
  return "other";
}

function explicitParent(render: RenderEvent): ComponentId | null {
  for (const reason of render.reasons) {
    if (reason.type === "parent") return reason.componentId;
  }
  return null;
}

function rawId(renderId: RenderId): string {
  return `r:${renderId as number}`;
}

function commitComponentKey(commitId: CommitId, componentId: ComponentId): string {
  return `${commitId as number}:${componentId as number}`;
}

function nearestRenderingAncestor(
  store: TraceStore,
  render: RenderEvent,
  byCommitComponent: ReadonlyMap<string, RenderId>,
): RenderId | null {
  const direct = explicitParent(render);
  if (direct !== null) {
    const directRender = byCommitComponent.get(commitComponentKey(render.commitId, direct));
    if (directRender !== undefined) return directRender;
  }

  const seen = new Set<ComponentId>();
  let parent = store.instance(render.componentId)?.parentId;
  while (parent !== undefined && !seen.has(parent)) {
    seen.add(parent);
    const candidate = byCommitComponent.get(commitComponentKey(render.commitId, parent));
    if (candidate !== undefined) return candidate;
    parent = store.instance(parent)?.parentId;
  }
  return null;
}

interface RawGraph {
  renders: RenderEvent[];
  parentByRender: Map<RenderId, RenderId>;
  childrenByRender: Map<RenderId, RenderId[]>;
  depthByRender: Map<RenderId, number>;
}

function buildRawGraph(store: TraceStore, interaction: Interaction): RawGraph {
  const renders: RenderEvent[] = [];
  const byCommitComponent = new Map<string, RenderId>();

  for (const renderId of interaction.renderIds) {
    const render = store.getRender(renderId);
    if (!render) continue;
    renders.push(render);
    byCommitComponent.set(commitComponentKey(render.commitId, render.componentId), render.renderId);
  }

  renders.sort(
    (a, b) => a.timestamp - b.timestamp || (a.renderId as number) - (b.renderId as number),
  );

  const renderSet = new Set(renders.map((render) => render.renderId));
  const parentByRender = new Map<RenderId, RenderId>();
  const childrenByRender = new Map<RenderId, RenderId[]>();

  for (const render of renders) {
    const cause = causeOf(render);
    if (cause === "state" || cause === "mount") continue;
    const parent = nearestRenderingAncestor(store, render, byCommitComponent);
    if (parent === null || !renderSet.has(parent) || parent === render.renderId) continue;
    parentByRender.set(render.renderId, parent);
    const children = childrenByRender.get(parent);
    if (children) children.push(render.renderId);
    else childrenByRender.set(parent, [render.renderId]);
  }

  const depthByRender = new Map<RenderId, number>();
  const depthOf = (renderId: RenderId, visiting = new Set<RenderId>()): number => {
    const cached = depthByRender.get(renderId);
    if (cached !== undefined) return cached;
    if (visiting.has(renderId)) return 0;
    visiting.add(renderId);
    const parent = parentByRender.get(renderId);
    const depth = parent === undefined ? 0 : depthOf(parent, visiting) + 1;
    visiting.delete(renderId);
    depthByRender.set(renderId, depth);
    return depth;
  };
  for (const render of renders) depthOf(render.renderId);

  return { renders, parentByRender, childrenByRender, depthByRender };
}

function aggregateKey(parentId: string | null, node: CascadeRenderNode): string {
  return `${parentId ?? "root"}|${node.depth}|${node.name}|${node.cause}`;
}

/**
 * Builds only the selected interaction. Cost is O(renders in that interaction × fiber depth),
 * never O(total session). Pan/zoom operate on the returned immutable projection only.
 */
export function buildCascadeProjection(
  store: TraceStore,
  interaction: Interaction,
  options: CascadeProjectionOptions = {},
): CascadeProjection {
  const aggregateThreshold = options.aggregateThreshold ?? DEFAULT_AGGREGATE_THRESHOLD;
  const maxVisibleNodes = options.maxVisibleNodes ?? DEFAULT_MAX_VISIBLE_NODES;
  const expanded = options.expandedAggregateKeys ?? new Set<string>();
  const raw = buildRawGraph(store, interaction);

  const rawNodes = new Map<RenderId, CascadeRenderNode>();
  for (const render of raw.renders) {
    const parentRender = raw.parentByRender.get(render.renderId);
    rawNodes.set(render.renderId, {
      id: rawId(render.renderId),
      kind: "render",
      renderId: render.renderId,
      renderIds: [render.renderId],
      componentId: render.componentId,
      commitId: render.commitId,
      name: store.instance(render.componentId)?.name ?? `#${render.componentId as number}`,
      cause: causeOf(render),
      timestamp: render.timestamp,
      duration: Math.max(render.totalDuration, render.selfDuration),
      selfDuration: render.selfDuration,
      depth: raw.depthByRender.get(render.renderId) ?? 0,
      parentId: parentRender === undefined ? null : rawId(parentRender),
      childCount: raw.childrenByRender.get(render.renderId)?.length ?? 0,
      aggregateCount: 1,
    });
  }

  // Collapse repeated leaf siblings (ProductCard × N is the common case).
  const leafGroups = new Map<string, CascadeRenderNode[]>();
  for (const node of rawNodes.values()) {
    if (node.childCount !== 0) continue;
    const key = aggregateKey(node.parentId, node);
    const list = leafGroups.get(key);
    if (list) list.push(node);
    else leafGroups.set(key, [node]);
  }

  const hidden = new Set<string>();
  const aggregates: CascadeAggregateNode[] = [];
  let aggregateSequence = 0;
  for (const [key, group] of leafGroups) {
    if (group.length < aggregateThreshold || expanded.has(key)) continue;
    for (const node of group) hidden.add(node.id);
    const first = group[0]!;
    const renderIds = group.map((node) => node.renderId);
    aggregates.push({
      id: `g:${aggregateSequence++}:${key}`,
      kind: "aggregate",
      renderId: null,
      renderIds,
      componentId: null,
      commitId: first.commitId,
      name: `${first.name} ×${group.length}`,
      cause: first.cause,
      timestamp: Math.min(...group.map((node) => node.timestamp)),
      duration: Math.max(...group.map((node) => node.timestamp + node.duration)) - first.timestamp,
      selfDuration: group.reduce((sum, node) => sum + node.selfDuration, 0),
      depth: first.depth,
      parentId: first.parentId,
      childCount: 0,
      aggregateCount: group.length,
    });
  }

  let nodes: CascadeNode[] = [...rawNodes.values()].filter((node) => !hidden.has(node.id));
  nodes.push(...aggregates);

  // Hard guard for huge fan-out that did not share component names. Preserve all
  // non-leaves, roots and the most expensive leaves; summarize the rest.
  if (nodes.length > maxVisibleNodes) {
    const structural = nodes.filter(
      (node) => node.kind === "aggregate" || node.childCount > 0 || node.depth === 0,
    );
    const structuralIds = new Set(structural.map((node) => node.id));
    const leaves = nodes
      .filter((node) => !structuralIds.has(node.id))
      .sort((a, b) => b.selfDuration - a.selfDuration || a.timestamp - b.timestamp);
    const room = Math.max(0, maxVisibleNodes - structural.length - 1);
    const kept = leaves.slice(0, room);
    const omitted = leaves.slice(room);
    nodes = [...structural, ...kept];
    if (omitted.length > 0) {
      nodes.push({
        id: "g:overflow",
        kind: "aggregate",
        renderId: null,
        renderIds: omitted.flatMap((node) => [...node.renderIds]),
        componentId: null,
        commitId: null,
        name: `${omitted.length.toLocaleString()} more renders`,
        cause: "other",
        timestamp: Math.min(...omitted.map((node) => node.timestamp)),
        duration:
          Math.max(...omitted.map((node) => node.timestamp + node.duration)) - interaction.start,
        selfDuration: omitted.reduce((sum, node) => sum + node.selfDuration, 0),
        depth: Math.max(1, ...omitted.map((node) => node.depth)),
        parentId: null,
        childCount: 0,
        aggregateCount: omitted.reduce((sum, node) => sum + node.aggregateCount, 0),
      });
    }
  }

  const visibleIds = new Set(nodes.map((node) => node.id));
  const aggregateByMember = new Map<string, string>();
  for (const aggregate of aggregates) {
    if (!visibleIds.has(aggregate.id)) continue;
    for (const renderId of aggregate.renderIds)
      aggregateByMember.set(rawId(renderId), aggregate.id);
  }

  const edgePairs = new Map<
    string,
    { from: string; to: string; cause: CascadeCause; timestamp: number }
  >();
  for (const render of raw.renders) {
    const parent = raw.parentByRender.get(render.renderId);
    if (parent === undefined) continue;
    const rawFrom = rawId(parent);
    const rawTo = rawId(render.renderId);
    const from = aggregateByMember.get(rawFrom) ?? rawFrom;
    const to = aggregateByMember.get(rawTo) ?? rawTo;
    if (from === to || !visibleIds.has(from) || !visibleIds.has(to)) continue;
    const key = `${from}>${to}`;
    if (!edgePairs.has(key))
      edgePairs.set(key, { from, to, cause: causeOf(render), timestamp: render.timestamp });
  }

  const edges = [...edgePairs.values()]
    .sort(
      (a, b) =>
        a.timestamp - b.timestamp || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    )
    .map(
      (edge, index): CascadeEdge => ({
        id: `e:${index}:${edge.from}:${edge.to}`,
        from: edge.from,
        to: edge.to,
        order: index + 1,
        cause: edge.cause,
      }),
    );

  const roots = nodes
    .filter((node) => node.parentId === null || !visibleIds.has(node.parentId))
    .map((node) => node.id);
  const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);
  const aggregatedRenderCount = nodes.reduce(
    (sum, node) => sum + (node.kind === "aggregate" ? node.aggregateCount : 0),
    0,
  );

  return {
    interaction,
    nodes,
    edges,
    roots,
    totalRenderCount: raw.renders.length,
    totalSelfTime: raw.renders.reduce((sum, render) => sum + render.selfDuration, 0),
    maxDepth,
    aggregatedRenderCount,
  };
}

export function aggregateExpansionKey(node: CascadeAggregateNode): string | null {
  if (node.id === "g:overflow" || node.renderIds.length === 0) return null;
  const first = node.name.replace(/ ×\d+$/, "");
  return `${node.parentId ?? "root"}|${node.depth}|${first}|${node.cause}`;
}
