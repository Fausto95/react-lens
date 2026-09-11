import type { ComponentId } from "@reactlens/protocol";
import { cascadeBaseName, type CascadeCause, type CascadeProjection } from "./model.js";

/**
 * Roll-up projection — the cascade aggregated by component instead of by
 * render. This is the view that answers "what do I fix": how many times each
 * component rendered, why, what it cost, and a verdict. The graph and the
 * ledger are the drill-down from here.
 *
 * Pure: plain data in, plain data out, no React and no DOM.
 */

export type RollupTone = "hot" | "passenger" | "repeat" | "none";

export interface RollupVerdict {
  tone: RollupTone;
  text: string;
}

export interface RollupRow {
  name: string;
  /** Renders of this component in the interaction, counting aggregate members. */
  renderCount: number;
  causes: ReadonlyMap<CascadeCause, number>;
  dominantCause: CascadeCause;
  /** Self time in ms, summed over every instance. */
  selfTime: number;
  /** Share of the interaction's total self time, 0..1. */
  share: number;
  minDepth: number;
  maxDepth: number;
  /** Renders this component dragged along below it. */
  carried: number;
  /** Renders the React Compiler compiled. */
  compiledCount: number;
  /** Renders the runtime reported *any* compiler status for. */
  compilerKnownCount: number;
  /** The Doctor flagged at least one instance of this component. */
  flagged: boolean;
  /**
   * Renders whose props came from an owner other than the cascade parent —
   * the cross-tree edges. Counts aggregate members.
   */
  crossTree: number;
  /** Changed prop keys, ranked by how many renders each crossed. */
  propKeys: ReadonlyMap<string, number>;
  verdict: RollupVerdict;
  /** Costliest instance — where a drill-down should land. */
  anchorId: string;
}

export type RollupSortKey = "name" | "renderCount" | "selfTime" | "minDepth";

export interface RollupSort {
  key: RollupSortKey;
  dir: "asc" | "desc";
}

/** Above this share of the interaction a component is the thing to look at. */
const HOT_SHARE = 0.2;
/** Below this per-render self time a component did no work worth the render. */
const IDLE_MS = 0.05;
/** A component only reads as a passenger once the pattern repeats. */
const PASSENGER_AT = 3;

function verdictFor(row: Omit<RollupRow, "verdict">): RollupVerdict {
  const passenger =
    row.renderCount >= PASSENGER_AT &&
    row.dominantCause !== "state" &&
    row.selfTime / row.renderCount < IDLE_MS;

  if (passenger) {
    return {
      tone: "passenger",
      text:
        row.carried > 0
          ? `passenger · carries ${row.carried.toLocaleString()} more`
          : "passenger · no work of its own",
    };
  }
  if (row.share > HOT_SHARE) return { tone: "hot", text: "hot · dominates" };
  if (row.renderCount >= 2)
    return { tone: "repeat", text: `${row.renderCount.toLocaleString()}× this interaction` };
  return { tone: "none", text: "—" };
}

/** Most-crossed key first; name breaks ties so the order never flickers. */
function rankedKeys(keys: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  return new Map([...keys.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

/**
 * @param flagged Components the Doctor has an issue with. These used to surface
 *   as a "Watchlist" section in the Components pane; with that pane gone the
 *   warning travels with the component, wherever it is read.
 */
export function buildRollup(
  projection: CascadeProjection,
  flagged: ReadonlySet<ComponentId> = new Set(),
): RollupRow[] {
  interface Bucket {
    name: string;
    renderCount: number;
    causes: Map<CascadeCause, number>;
    selfTime: number;
    minDepth: number;
    maxDepth: number;
    carried: number;
    compiledCount: number;
    compilerKnownCount: number;
    flagged: boolean;
    crossTree: number;
    propKeys: Map<string, number>;
    anchorId: string;
    anchorSelf: number;
  }

  const childCountById = new Map<string, number>();
  for (const node of projection.nodes) {
    if (node.parentId === null) continue;
    childCountById.set(node.parentId, (childCountById.get(node.parentId) ?? 0) + 1);
  }

  const buckets = new Map<string, Bucket>();
  for (const node of projection.nodes) {
    const name = cascadeBaseName(node);
    const bucket = buckets.get(name) ?? {
      name,
      renderCount: 0,
      causes: new Map<CascadeCause, number>(),
      selfTime: 0,
      minDepth: node.depth,
      maxDepth: node.depth,
      carried: 0,
      compiledCount: 0,
      compilerKnownCount: 0,
      flagged: false,
      crossTree: 0,
      propKeys: new Map<string, number>(),
      anchorId: node.id,
      anchorSelf: -1,
    };
    bucket.renderCount += node.aggregateCount;
    bucket.causes.set(node.cause, (bucket.causes.get(node.cause) ?? 0) + node.aggregateCount);
    bucket.selfTime += node.selfDuration;
    bucket.minDepth = Math.min(bucket.minDepth, node.depth);
    bucket.maxDepth = Math.max(bucket.maxDepth, node.depth);
    bucket.carried += childCountById.get(node.id) ?? 0;
    if (node.compiled !== null) {
      bucket.compilerKnownCount += node.aggregateCount;
      if (node.compiled) bucket.compiledCount += node.aggregateCount;
    }
    if (node.componentId !== null && flagged.has(node.componentId)) bucket.flagged = true;
    if (node.ownerEdge === true) bucket.crossTree += node.aggregateCount;
    for (const key of node.changedProps)
      bucket.propKeys.set(key, (bucket.propKeys.get(key) ?? 0) + node.aggregateCount);
    if (node.selfDuration > bucket.anchorSelf) {
      bucket.anchorSelf = node.selfDuration;
      bucket.anchorId = node.id;
    }
    buckets.set(name, bucket);
  }

  const total = projection.totalSelfTime;
  return [...buckets.values()].map((bucket) => {
    const dominantCause = [...bucket.causes.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]![0];
    const base = {
      name: bucket.name,
      renderCount: bucket.renderCount,
      causes: bucket.causes,
      dominantCause,
      selfTime: bucket.selfTime,
      share: total > 0 ? bucket.selfTime / total : 0,
      minDepth: bucket.minDepth,
      maxDepth: bucket.maxDepth,
      carried: bucket.carried,
      compiledCount: bucket.compiledCount,
      compilerKnownCount: bucket.compilerKnownCount,
      flagged: bucket.flagged,
      crossTree: bucket.crossTree,
      propKeys: rankedKeys(bucket.propKeys),
      anchorId: bucket.anchorId,
    };
    return { ...base, verdict: verdictFor(base) };
  });
}

/** Name is always the tiebreak, so the order never flickers between renders. */
export function sortRollup(rows: readonly RollupRow[], sort: RollupSort): RollupRow[] {
  const direction = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary =
      sort.key === "name"
        ? a.name.localeCompare(b.name)
        : (a[sort.key] as number) - (b[sort.key] as number);
    return primary * direction || a.name.localeCompare(b.name);
  });
}
