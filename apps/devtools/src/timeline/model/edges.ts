import type { TraceStore } from "@reactlens/trace-engine";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import { causeOf, type ClipCause } from "./lanes.js";

/**
 * Causality arrows: render → render edges reconstructed inside a commit.
 *
 * React tells us *why* a component rendered, not *which render* caused it. We
 * recover the edge structurally: a render's cause is the nearest ancestor that
 * rendered in the same commit. That's the honest reconstruction — a state
 * update is an origin (no incoming edge), and everything downstream of it
 * chains back to it, which is exactly the waterfall the eye needs.
 */

export interface CausalEdge {
  from: RenderId;
  to: RenderId;
  /** The cause of the *target* render — the arrow is colored by what it did. */
  cause: ClipCause;
}

/** Edges among the renders of one commit, keyed for fast chain walks. */
export interface CommitEdges {
  edges: CausalEdge[];
  /** renderId → the render that caused it (at most one). */
  causeOfRender: Map<RenderId, RenderId>;
  /** renderId → the renders it caused. */
  effectsOfRender: Map<RenderId, RenderId[]>;
}

const EMPTY: CommitEdges = {
  edges: [],
  causeOfRender: new Map(),
  effectsOfRender: new Map(),
};

/** Ancestor chain via instance.parentId, nearest first. Cycle-safe. */
function ancestors(store: TraceStore, id: ComponentId): ComponentId[] {
  const out: ComponentId[] = [];
  const seen = new Set<ComponentId>([id]);
  let cur = store.instance(id)?.parentId;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = store.instance(cur)?.parentId;
  }
  return out;
}

export function edgesForCommit(store: TraceStore, renderId: RenderId): CommitEdges {
  const seed = store.getRender(renderId);
  if (!seed) return EMPTY;
  const commit = store.commit(seed.commitId);
  if (!commit) return EMPTY;

  // One render per component per commit (React performs work once).
  const renderByComponent = new Map<ComponentId, RenderId>();
  for (const componentId of commit.componentIds) {
    for (const render of store.rendersOf(componentId)) {
      if (render.commitId === seed.commitId) {
        renderByComponent.set(componentId, render.renderId);
        break;
      }
    }
  }

  const edges: CausalEdge[] = [];
  const causeOfRender = new Map<RenderId, RenderId>();
  const effectsOfRender = new Map<RenderId, RenderId[]>();

  for (const [componentId, targetRender] of renderByComponent) {
    const render = store.getRender(targetRender);
    if (!render) continue;
    const cause = causeOf(render);
    // A local state update starts a cascade; it is never downstream of one.
    if (cause === "state" || cause === "mount") continue;
    for (const ancestorId of ancestors(store, componentId)) {
      const sourceRender = renderByComponent.get(ancestorId);
      if (sourceRender === undefined) continue;
      edges.push({ from: sourceRender, to: targetRender, cause });
      causeOfRender.set(targetRender, sourceRender);
      const list = effectsOfRender.get(sourceRender);
      if (list) list.push(targetRender);
      else effectsOfRender.set(sourceRender, [targetRender]);
      break; // nearest rendering ancestor only
    }
  }

  return { edges, causeOfRender, effectsOfRender };
}

/**
 * The arrows to draw for a selection: every edge the selected render is an
 * endpoint of — what caused it, and everything it caused.
 *
 * Deliberately one level in each direction, not the transitive chain: on a
 * real cascade the full closure is hundreds of curves and reads as noise. The
 * complete chain back to the origin is told in words by the inspector's Cause
 * section instead.
 */
export function chainFor(commit: CommitEdges, renderId: RenderId): CausalEdge[] {
  return commit.edges.filter((e) => e.from === renderId || e.to === renderId);
}

/** The origin render of a cascade — what the inspector's chain starts from. */
export function originOf(commit: CommitEdges, renderId: RenderId): RenderId {
  const seen = new Set<RenderId>();
  let cur = renderId;
  while (!seen.has(cur)) {
    seen.add(cur);
    const next = commit.causeOfRender.get(cur);
    if (next === undefined) return cur;
    cur = next;
  }
  return cur;
}

/** How many renders the cascade from this origin ultimately produced. */
export function cascadeSize(commit: CommitEdges, originRender: RenderId): number {
  let count = 0;
  const stack = [originRender];
  const seen = new Set<RenderId>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const child of commit.effectsOfRender.get(cur) ?? []) {
      count++;
      stack.push(child);
    }
  }
  return count;
}
