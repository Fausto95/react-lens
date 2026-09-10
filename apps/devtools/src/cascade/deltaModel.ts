import type { Interaction, TraceStore } from "@reactlens/trace-engine";
import { cascadeBaseName, type CascadeProjection } from "./model.js";

/**
 * Delta projection — what changed since the last time this happened.
 *
 * A full cascade is a poster; the delta is the debugging tool. Two
 * interactions are comparable when the same component's state started them
 * (the same button, the same field), and the diff is keyed by component name
 * rather than instance id because instances remount between runs.
 *
 * Pure: plain data in, plain data out, no React and no DOM.
 */

export interface CascadeDelta {
  /** The interaction compared against. */
  against: Interaction;
  /** Node ids whose component did not render in the previous interaction. */
  newRenders: ReadonlySet<string>;
  /**
   * Node id → prop keys that did not cross for that component before. Absent
   * for a new render — its keys are all new, and `newRenders` already says so.
   */
  newKeysByNode: ReadonlyMap<string, readonly string[]>;
  /** Components that rendered before and not now, sorted. */
  gone: readonly string[];
  /** Every node id in `newRenders` or `newKeysByNode`. */
  changed: ReadonlySet<string>;
}

/** How far back to look for a comparable interaction. */
const LOOKBACK = 40;

/**
 * What started the interaction: the components that set state, by name, so
 * two clicks on the same button compare whatever else cascaded. A mount or a
 * store-driven interaction sets no state, so it keys by label instead.
 */
export function originKeyOf(store: TraceStore, interaction: Interaction): string {
  const origins = new Set<string>();
  for (const renderId of interaction.renderIds) {
    const render = store.getRender(renderId);
    if (!render || !render.reasons.some((reason) => reason.type === "state")) continue;
    origins.add(store.instance(render.componentId)?.name ?? `#${render.componentId as number}`);
  }
  if (origins.size === 0) return `label:${interaction.label}`;
  return [...origins].sort().join("+");
}

/** The nearest earlier interaction with the same origin, or `null`. */
export function previousComparable(
  store: TraceStore,
  interactions: readonly Interaction[],
  current: Interaction,
): Interaction | null {
  const index = interactions.findIndex((item) => item.id === current.id);
  if (index <= 0) return null;
  const key = originKeyOf(store, current);
  for (let i = index - 1; i >= Math.max(0, index - LOOKBACK); i--) {
    const candidate = interactions[i]!;
    if (originKeyOf(store, candidate) === key) return candidate;
  }
  return null;
}

export function diffCascades(before: CascadeProjection, after: CascadeProjection): CascadeDelta {
  const keysBefore = new Map<string, Set<string>>();
  for (const node of before.nodes) {
    const name = cascadeBaseName(node);
    const keys = keysBefore.get(name) ?? new Set<string>();
    for (const key of node.changedProps) keys.add(key);
    keysBefore.set(name, keys);
  }

  const newRenders = new Set<string>();
  const newKeysByNode = new Map<string, readonly string[]>();
  const seenNow = new Set<string>();
  for (const node of after.nodes) {
    const name = cascadeBaseName(node);
    seenNow.add(name);
    const previous = keysBefore.get(name);
    if (previous === undefined) {
      newRenders.add(node.id);
      continue;
    }
    const fresh = node.changedProps.filter((key) => !previous.has(key));
    if (fresh.length > 0) newKeysByNode.set(node.id, fresh);
  }

  const gone = [...keysBefore.keys()].filter((name) => !seenNow.has(name)).sort();
  const changed = new Set([...newRenders, ...newKeysByNode.keys()]);
  return { against: before.interaction, newRenders, newKeysByNode, gone, changed };
}
