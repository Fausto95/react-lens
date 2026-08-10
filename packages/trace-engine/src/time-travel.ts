import type { ComponentId, RenderId, TimeTravelEntry } from "@react-lens/protocol";
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
