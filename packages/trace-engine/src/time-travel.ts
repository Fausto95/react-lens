import type { ComponentId, RenderId, TimeTravelEntry } from "@reactlens/protocol";
import type { TraceStore } from "./trace-store.js";

/**
 * The apply set at time `t`: for every known component instance, the render
 * whose state the page should show. Components with no retained render at or
 * before `t` (born later, or history evicted past `t`) are absent — the page
 * cannot unmount them, so they are left as-is and the tree dims them.
 */
export function applySetAt(store: TraceStore, t: number): Map<ComponentId, RenderId> {
  const set = new Map<ComponentId, RenderId>();
  for (const instance of store.allInstances()) {
    const render = store.renderAtOrBefore(instance.id, t);
    if (render) set.set(instance.id, render.renderId);
  }
  return set;
}

/**
 * Entries in `next` that are new or point at a different render than `prev`.
 * Entries only in `prev` are dropped silently: their component simply keeps
 * its last applied state (there is nothing meaningful to reset it to).
 */
export function diffApplySet(
  prev: ReadonlyMap<ComponentId, RenderId>,
  next: ReadonlyMap<ComponentId, RenderId>,
): TimeTravelEntry[] {
  const delta: TimeTravelEntry[] = [];
  for (const [componentId, renderId] of next) {
    if (prev.get(componentId) !== renderId) delta.push({ componentId, renderId });
  }
  return delta;
}

export interface ApplySetChange {
  componentId: ComponentId;
  /** Render shown at A, or null when the component had none retained there. */
  renderA: RenderId | null;
  renderB: RenderId | null;
}

export interface ApplySetComparison {
  changed: ApplySetChange[];
  unchangedCount: number;
}

/**
 * Whole-app A/B: which components would show a different render at `a` vs
 * `b`. Null on one side means the component had no retained render there
 * (born later, or history evicted).
 */
export function compareApplySets(store: TraceStore, a: number, b: number): ApplySetComparison {
  const setA = applySetAt(store, Math.min(a, b));
  const setB = applySetAt(store, Math.max(a, b));
  const changed: ApplySetChange[] = [];
  let unchangedCount = 0;
  const ids = new Set<ComponentId>([...setA.keys(), ...setB.keys()]);
  for (const componentId of ids) {
    const renderA = setA.get(componentId) ?? null;
    const renderB = setB.get(componentId) ?? null;
    if (renderA === renderB) unchangedCount++;
    else changed.push({ componentId, renderA, renderB });
  }
  return { changed, unchangedCount };
}

export interface ApplySetCursor {
  /** The apply set at `t`, recomputing only components that rendered between moves. */
  moveTo(t: number): Map<ComponentId, RenderId>;
  /** Forget incremental state (call after the store ingests or evicts). */
  reset(): void;
}

/**
 * Incremental `applySetAt` for scrubbing: consecutive moves only re-resolve
 * components with a commit inside the crossed interval — every other entry is
 * unchanged by construction. A full recompute stays the correctness oracle
 * (see the property test) and runs on the first move after reset().
 */
export function createApplySetCursor(store: TraceStore): ApplySetCursor {
  let current: Map<ComponentId, RenderId> | null = null;
  let prevT = 0;

  return {
    moveTo(t: number): Map<ComponentId, RenderId> {
      if (current === null) {
        current = applySetAt(store, t);
        prevT = t;
        return new Map(current);
      }
      const lo = Math.min(prevT, t);
      const hi = Math.max(prevT, t);
      prevT = t;
      // Components with a render in (lo, hi] are exactly those whose
      // render-at-or-before answer can differ between the two cursors. A
      // commit's renders span [timestamp, endTimestamp], so touch every
      // commit whose span intersects the crossed interval.
      const commits = store.commits();
      const touched = new Set<ComponentId>();
      for (const c of commits) {
        if (c.timestamp > hi) break;
        if (c.endTimestamp > lo) for (const id of c.componentIds) touched.add(id);
      }
      for (const id of touched) {
        const render = store.renderAtOrBefore(id, t);
        if (render) current.set(id, render.renderId);
        else current.delete(id);
      }
      return new Map(current);
    },
    reset() {
      current = null;
    },
  };
}
