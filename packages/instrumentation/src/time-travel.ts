import {
  TIME_TRAVEL_RETENTION,
  type ComponentId,
  type RenderId,
  type TimeTravelEntry,
  type TimeTravelFailure,
  type TimeTravelFailureReason,
  type TimeTravelResult,
} from "@reactlens/protocol";
import type { Fiber, FiberBridge, LiveState } from "@reactlens/fiber";
import { captureStateHooks, inspectClassState } from "@reactlens/fiber";

/**
 * Opt-in seam for state living outside React (Zustand, Redux, module
 * singletons). The page registers adapters; snapshots are captured per commit
 * and restored alongside component state when the cursor moves. Values never
 * leave the page.
 */
export interface TimeTravelStoreAdapter {
  /** Stable identifier, unique per registered store. */
  id: string;
  /** An immutable (or safely re-applicable) snapshot of the store's state. */
  getSnapshot(): unknown;
  applySnapshot(snapshot: unknown): void;
}

/**
 * Page-side time travel: a bounded history of RAW state values per render,
 * and an applier that writes them back through the renderer's dev-only
 * override API. Raw references never leave the page — the panel only sends
 * (componentId, renderId) pairs plus the cursor time for store adapters.
 */
export interface TimeTravelController {
  /** Whether the renderer exposes the override API (dev builds only). */
  supported(): boolean;
  /** True between the first apply and one macrotask after goLive. */
  isActive(): boolean;
  /** Record the raw state a component had at `renderId`. Called per commit. */
  capture(renderId: RenderId, componentId: ComponentId, fiber: Fiber): void;
  /** Snapshot every registered store adapter. Called per commit. */
  captureStores(timestamp: number): void;
  /** Opt-in external-store rewind. Returns an unregister function. */
  registerStore(adapter: TimeTravelStoreAdapter): () => void;
  /**
   * Restore each entry's captured state; with `atT`, also restore every
   * registered store to its snapshot at or before that time. Enters active mode.
   */
  apply(entries: TimeTravelEntry[], atT?: number): TimeTravelResult;
  /** Restore the pre-travel live baselines and resume normal recording. */
  goLive(): TimeTravelResult;
  clear(): void;
}

interface CapturedState {
  hooks: Array<{ index: number; value: unknown }>;
  classState?: unknown;
}

interface StoreRegistration {
  adapter: TimeTravelStoreAdapter;
  /** timestamp → snapshot, insertion-ordered ring. */
  history: Map<number, unknown>;
}

const DEFAULT_SNAPSHOTS_PER_STORE = 200;

export function createTimeTravel(deps: {
  fiber: FiberBridge;
  /** Raw-state renders retained per component (mirrors the panel's render ring). */
  rendersPerComponent?: number;
  /** Component histories retained, least-recently-captured evicted first. */
  maxComponents?: number;
  /** Snapshots retained per registered external store. */
  snapshotsPerStore?: number;
}): TimeTravelController {
  const { fiber } = deps;
  const rendersPerComponent = deps.rendersPerComponent ?? TIME_TRAVEL_RETENTION.rendersPerComponent;
  const maxComponents = deps.maxComponents ?? TIME_TRAVEL_RETENTION.maxComponents;
  const snapshotsPerStore = deps.snapshotsPerStore ?? DEFAULT_SNAPSHOTS_PER_STORE;

  /**
   * componentId → (renderId → raw state), both insertion-ordered. Retention is
   * per component so one chatty component cannot evict another's history; the
   * outer map is LRU on capture so long-dead components eventually free theirs.
   */
  const history = new Map<ComponentId, Map<RenderId, CapturedState>>();
  /**
   * Live state per component at the moment travel first touched it. goLive
   * restores these — robust even when the newest render was ring-evicted.
   */
  const baselines = new Map<ComponentId, CapturedState>();
  /** Components with nothing to restore — apply treats them as no-ops, not failures. */
  const stateless = new Set<ComponentId>();
  /** Opt-in external stores, keyed by adapter id. */
  const stores = new Map<string, StoreRegistration>();
  /** Live store snapshots at the moment travel first touched them. */
  const storeBaselines = new Map<string, unknown>();
  let active = false;

  function supported(): boolean {
    return fiber.canEditValues();
  }

  function capture(renderId: RenderId, componentId: ComponentId, target: Fiber): void {
    // No override API → nothing could ever be applied; don't retain references.
    if (!supported()) return;
    const classState = inspectClassState(target);
    const state: CapturedState =
      classState !== undefined ? { hooks: [], classState } : { hooks: captureStateHooks(target) };
    // Stateless components would produce no-op entries; keep them out of the
    // rings so frequent stateless renders can't evict restorable history.
    if (state.hooks.length === 0 && classState === undefined) {
      stateless.add(componentId);
      return;
    }
    stateless.delete(componentId);
    let ring = history.get(componentId);
    if (ring) {
      // Re-insert to refresh the component's LRU position.
      history.delete(componentId);
    } else {
      ring = new Map();
    }
    history.set(componentId, ring);
    ring.set(renderId, state);
    if (ring.size > rendersPerComponent) {
      const oldest = ring.keys().next().value;
      if (oldest !== undefined) ring.delete(oldest);
    }
    if (history.size > maxComponents) {
      const lru = history.keys().next().value;
      if (lru !== undefined) history.delete(lru);
    }
  }

  function captureStores(timestamp: number): void {
    if (active) return; // never record the rewound values as history
    for (const reg of stores.values()) {
      try {
        reg.history.set(timestamp, reg.adapter.getSnapshot());
      } catch {
        continue; // a broken getSnapshot must not break capture for others
      }
      if (reg.history.size > snapshotsPerStore) {
        const oldest = reg.history.keys().next().value;
        if (oldest !== undefined) reg.history.delete(oldest);
      }
    }
  }

  function registerStore(adapter: TimeTravelStoreAdapter): () => void {
    stores.set(adapter.id, { adapter, history: new Map() });
    return () => {
      stores.delete(adapter.id);
      storeBaselines.delete(adapter.id);
    };
  }

  /** Restore every registered store to its snapshot at or before `t`. */
  function applyStores(t: number): { applied: number; failed: number } {
    let applied = 0;
    let failed = 0;
    for (const [id, reg] of stores) {
      // History is insertion-ordered by capture time; walk for the last ≤ t.
      let best: { has: boolean; value: unknown } = { has: false, value: undefined };
      for (const [ts, value] of reg.history) {
        if (ts <= t) best = { has: true, value };
        else break;
      }
      if (!best.has) {
        failed++;
        continue;
      }
      try {
        if (!storeBaselines.has(id)) storeBaselines.set(id, reg.adapter.getSnapshot());
        reg.adapter.applySnapshot(best.value);
        active = true;
        applied++;
      } catch {
        failed++;
      }
    }
    return { applied, failed };
  }

  function apply(entries: TimeTravelEntry[], atT?: number): TimeTravelResult {
    if (!supported()) {
      return { applied: 0, failed: entries.length, supported: false, failures: [] };
    }
    let applied = 0;
    const failures: TimeTravelFailure[] = [];
    const fail = (entry: TimeTravelEntry, reason: TimeTravelFailureReason) =>
      failures.push({ componentId: entry.componentId, renderId: entry.renderId, reason });
    for (const entry of entries) {
      const state = history.get(entry.componentId)?.get(entry.renderId);
      if (!state) {
        if (!stateless.has(entry.componentId)) fail(entry, "no-history");
        continue;
      }
      if (!fiber.hasFiber(entry.componentId)) {
        fail(entry, "no-fiber");
        continue;
      }
      const live = fiber.captureLiveState(entry.componentId);
      if (!live || !shapeMatches(state, live)) {
        // Hook list changed shape since capture (e.g. hot reload) — overriding
        // by index would corrupt an unrelated hook. Refuse instead.
        fail(entry, "shape-mismatch");
        continue;
      }
      if (!baselines.has(entry.componentId)) baselines.set(entry.componentId, live);
      active = true;
      if (restore(entry.componentId, state)) applied++;
      else fail(entry, "write-failed");
    }
    let failed = failures.length;
    if (atT !== undefined && stores.size > 0) {
      const storeResult = applyStores(atT);
      applied += storeResult.applied;
      failed += storeResult.failed;
    }
    return { applied, failed, supported: true, failures };
  }

  function goLive(): TimeTravelResult {
    let applied = 0;
    let failed = 0;
    for (const [id, baseline] of storeBaselines) {
      const reg = stores.get(id);
      if (!reg) continue;
      try {
        reg.adapter.applySnapshot(baseline);
        applied++;
      } catch {
        failed++;
      }
    }
    storeBaselines.clear();
    if (baselines.size === 0) {
      if (active) {
        // Store restores flush like any commit; resume recording next macrotask.
        setTimeout(() => {
          active = false;
        }, 0);
      }
      return { applied, failed, supported: supported(), failures: [] };
    }
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
    return { applied, failed, supported: supported(), failures: [] };
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
    if (captured.classState !== undefined)
      return live.classState !== undefined || live.hooks.length === 0;
    if (captured.hooks.length !== live.hooks.length) return false;
    return captured.hooks.every((h, i) => live.hooks[i]?.index === h.index);
  }

  return {
    supported,
    isActive: () => active,
    capture,
    captureStores,
    registerStore,
    apply,
    goLive,
    clear: () => {
      history.clear();
      baselines.clear();
      stateless.clear();
      for (const reg of stores.values()) reg.history.clear();
      storeBaselines.clear();
      active = false;
    },
  };
}
