import type { ComponentId, RenderId, TimeTravelEntry, TimeTravelResult } from "@react-lens/protocol";
import type { Fiber, FiberBridge, LiveState } from "@react-lens/fiber";
import { captureStateHooks, inspectClassState } from "@react-lens/fiber";

/**
 * Page-side time travel: a bounded history of RAW state values per render,
 * and an applier that writes them back through the renderer's dev-only
 * override API. Raw references never leave the page — the panel only sends
 * (componentId, renderId) pairs.
 */
export interface TimeTravelController {
  /** Whether the renderer exposes the override API (dev builds only). */
  supported(): boolean;
  /** True between the first apply and one macrotask after goLive. */
  isActive(): boolean;
  /** Record the raw state a component had at `renderId`. Called per commit. */
  capture(renderId: RenderId, componentId: ComponentId, fiber: Fiber): void;
  /** Restore each entry's captured state. Enters active mode. */
  apply(entries: TimeTravelEntry[]): TimeTravelResult;
  /** Restore the pre-travel live baselines and resume normal recording. */
  goLive(): TimeTravelResult;
  clear(): void;
}

interface CapturedState {
  hooks: Array<{ index: number; value: unknown }>;
  classState?: unknown;
}

const DEFAULT_MAX_ENTRIES = 5_000;

export function createTimeTravel(deps: {
  fiber: FiberBridge;
  maxEntries?: number;
}): TimeTravelController {
  const { fiber } = deps;
  const maxEntries = deps.maxEntries ?? DEFAULT_MAX_ENTRIES;

  /** renderId → raw state at that render; insertion-ordered for eviction. */
  const history = new Map<RenderId, CapturedState>();
  /**
   * Live state per component at the moment travel first touched it. goLive
   * restores these — robust even when the newest render was ring-evicted.
   */
  const baselines = new Map<ComponentId, CapturedState>();
  /** Components with nothing to restore — apply treats them as no-ops, not failures. */
  const stateless = new Set<ComponentId>();
  let active = false;

  function supported(): boolean {
    return fiber.canEditValues();
  }

  function capture(renderId: RenderId, componentId: ComponentId, target: Fiber): void {
    // No override API → nothing could ever be applied; don't retain references.
    if (!supported()) return;
    const classState = inspectClassState(target);
    const state: CapturedState =
      classState !== undefined
        ? { hooks: [], classState }
        : { hooks: captureStateHooks(target) };
    // Stateless components would produce no-op entries; keep them out of the
    // ring so frequent stateless renders can't evict restorable history.
    if (state.hooks.length === 0 && classState === undefined) {
      stateless.add(componentId);
      return;
    }
    stateless.delete(componentId);
    history.set(renderId, state);
    if (history.size > maxEntries) {
      const oldest = history.keys().next().value;
      if (oldest !== undefined) history.delete(oldest);
    }
  }

  function apply(entries: TimeTravelEntry[]): TimeTravelResult {
    if (!supported()) return { applied: 0, failed: entries.length, supported: false };
    let applied = 0;
    let failed = 0;
    for (const entry of entries) {
      const state = history.get(entry.renderId);
      if (!state) {
        if (!stateless.has(entry.componentId)) failed++;
        continue;
      }
      if (!fiber.hasFiber(entry.componentId)) {
        failed++;
        continue;
      }
      const live = fiber.captureLiveState(entry.componentId);
      if (!live || !shapeMatches(state, live)) {
        // Hook list changed shape since capture (e.g. hot reload) — overriding
        // by index would corrupt an unrelated hook. Refuse instead.
        failed++;
        continue;
      }
      if (!baselines.has(entry.componentId)) baselines.set(entry.componentId, live);
      active = true;
      if (restore(entry.componentId, state)) applied++;
      else failed++;
    }
    return { applied, failed, supported: true };
  }

  function goLive(): TimeTravelResult {
    if (baselines.size === 0) {
      active = false;
      return { applied: 0, failed: 0, supported: supported() };
    }
    let applied = 0;
    let failed = 0;
    for (const [componentId, baseline] of baselines) {
      if (!fiber.hasFiber(componentId)) {
        failed++;
        continue;
      }
      if (restore(componentId, baseline)) applied++;
      else failed++;
    }
    baselines.clear();
    // The restore commit flushes in a microtask; stay suppressed until it has
    // passed, then resume recording on the next macrotask.
    setTimeout(() => {
      active = false;
    }, 0);
    return { applied, failed, supported: supported() };
  }

  function restore(componentId: ComponentId, state: CapturedState): boolean {
    if (state.classState !== undefined) {
      return fiber.setClassState(componentId, state.classState);
    }
    let ok = true;
    for (const hook of state.hooks) {
      // Empty path = replace the whole hook value (React's copyWithSet).
      if (!fiber.setHookState(componentId, hook.index, [], hook.value)) ok = false;
    }
    return ok;
  }

  function shapeMatches(captured: CapturedState, live: LiveState): boolean {
    if (captured.classState !== undefined) return live.classState !== undefined || live.hooks.length === 0;
    if (captured.hooks.length !== live.hooks.length) return false;
    return captured.hooks.every((h, i) => live.hooks[i]?.index === h.index);
  }

  return {
    supported,
    isActive: () => active,
    capture,
    apply,
    goLive,
    clear: () => {
      history.clear();
      baselines.clear();
      stateless.clear();
      active = false;
    },
  };
}
