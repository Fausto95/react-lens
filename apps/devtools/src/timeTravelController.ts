import type {
  ComponentId,
  RenderId,
  TimeTravelEntry,
  TimeTravelFailureReason,
  TimeTravelResult,
  TimeTravelStoreFailureReason,
} from "@reactlens/protocol";
import { createApplySetCursor, diffApplySet, type TraceStore } from "@reactlens/trace-engine";
import type { TimeCursor } from "./timeCursor.js";

/**
 * Page-facing time-travel commands. Synchronous in the embedded runtime,
 * promise-based over the extension's port channel.
 */
export interface TimeTravelApi {
  supported(): boolean | Promise<boolean>;
  /**
   * `atT` lets the page also rewind registered external-store adapters; `snap`
   * suppresses the page's transitions so the restore paints without easing.
   */
  apply(
    entries: TimeTravelEntry[],
    atT?: number,
    options?: { snap?: boolean },
  ): TimeTravelResult | Promise<TimeTravelResult>;
  goLive(): TimeTravelResult | Promise<TimeTravelResult>;
}

/**
 * Set-wide restore state while traveling. Each apply is only a delta, so the
 * controller accumulates: `applied` counts every component currently restored
 * on the page, `failedIds` every component that could not be restored (with
 * the page's reason), since travel began.
 */
export interface RestoreStatus {
  atT: number;
  applied: number;
  failedIds: ReadonlyMap<ComponentId, TimeTravelFailureReason>;
  /** Registered stores the page restored to this cursor time. */
  storesApplied: number;
  /** Stores that could not follow the cursor, with the page's reason. */
  storeFailures: ReadonlyMap<string, TimeTravelStoreFailureReason>;
}

export interface PanelTimeTravel {
  /** Feed every cursor change; applies state deltas while historical + enabled. */
  onCursor(cursor: TimeCursor, enabled: boolean): void;
  /**
   * Suppress the page's transitions while traveling. Pushed by the panel when
   * the pref changes, so the next apply carries it — the controller owns the
   * current value rather than reading panel state mid-render.
   */
  setSnap(on: boolean): void;
  /** Returns the page to live state (no-op if never traveled). */
  goLive(): void;
  dispose(): void;
}

/**
 * Bridges the timeline cursor to page-side state restoration: rAF-coalesces
 * scrub positions to the latest t, computes the apply set there, and sends
 * only the delta against what was last applied. Apply results feed `onStatus`
 * — the single error path for partial restores, including transport failures.
 */
export function createPanelTimeTravel(
  store: TraceStore,
  api: TimeTravelApi,
  onStatus?: (status: RestoreStatus | null) => void,
): PanelTimeTravel {
  let lastApplied = new Map<ComponentId, RenderId>();
  let pendingT: number | null = null;
  let raf = 0;
  /** rAF is paused in hidden tabs — a timer guarantees the flush still runs. */
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let traveling = false;
  // Incremental apply-set resolution across scrub frames; any ingest (rare
  // while traveling — recording is suppressed) invalidates it.
  const applyCursor = createApplySetCursor(store);
  const offIngest = store.onIngest(() => applyCursor.reset());
  /** Cumulative restore state since travel began. */
  const restoredIds = new Set<ComponentId>();
  const failedIds = new Map<ComponentId, TimeTravelFailureReason>();
  /**
   * Stores are not cumulative: every apply carries the cursor time, so each
   * one re-reports every registered store. The newest result is the truth.
   */
  let storesApplied = 0;
  let storeFailures = new Map<string, TimeTravelStoreFailureReason>();
  /** Monotonic apply generation; results arriving out of order are dropped. */
  let generation = 0;
  let lastProcessed = 0;
  /** Bumped only on goLive — cancels in-flight applies before they hit the page. */
  let travelEpoch = 0;
  /** Motion suppression, on unless the panel says otherwise. */
  let snap = true;

  function publish(atT: number): void {
    onStatus?.({
      atT,
      applied: restoredIds.size,
      failedIds: new Map(failedIds),
      storesApplied,
      storeFailures: new Map(storeFailures),
    });
  }

  function ingestResult(
    gen: number,
    t: number,
    delta: TimeTravelEntry[],
    result: TimeTravelResult,
  ): void {
    if (gen <= lastProcessed) return; // stale — a newer apply already reported
    lastProcessed = gen;
    storesApplied = result.storesApplied;
    storeFailures = new Map(result.storeFailures.map((f) => [f.storeId, f.reason] as const));
    const failedNow = new Map(result.failures.map((f) => [f.componentId, f.reason] as const));
    for (const entry of delta) {
      const reason = failedNow.get(entry.componentId);
      if (reason !== undefined) {
        failedIds.set(entry.componentId, reason);
        restoredIds.delete(entry.componentId);
      } else {
        restoredIds.add(entry.componentId);
        failedIds.delete(entry.componentId);
      }
    }
    publish(t);
  }

  function unschedule(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function flush(): void {
    unschedule();
    if (pendingT === null) return;
    const t = pendingT;
    pendingT = null;
    const next = applyCursor.moveTo(t);
    const delta = diffApplySet(lastApplied, next);
    lastApplied = next;
    // External-store adapters follow the cursor even between component
    // deltas, so an empty delta still applies once travel has begun.
    if (delta.length === 0 && !traveling) return;
    traveling = true;
    const gen = ++generation;
    const epoch = travelEpoch;
    Promise.resolve()
      .then(() => {
        // goLive bumped the epoch — never clobber the restored live page with
        // a scrub apply that was already queued as a microtask (replay End).
        if (epoch !== travelEpoch) return null;
        return api.apply(delta, t, { snap });
      })
      .then(
        (result) => {
          if (result == null || epoch !== travelEpoch) return;
          ingestResult(gen, t, delta, result);
        },
        () => {
          if (epoch !== travelEpoch) return;
          // Transport death (e.g. extension port closed): nothing landed.
          ingestResult(gen, t, delta, {
            applied: 0,
            failed: delta.length,
            supported: true,
            failures: delta.map((e) => ({ ...e, reason: "write-failed" as const })),
            storesApplied: 0,
            storeFailures: [],
          });
        },
      );
  }

  function goLive(): void {
    unschedule();
    pendingT = null;
    lastApplied = new Map();
    restoredIds.clear();
    failedIds.clear();
    storesApplied = 0;
    storeFailures = new Map();
    travelEpoch++;
    generation++;
    lastProcessed = generation; // in-flight results are now stale
    if (!traveling) return;
    traveling = false;
    onStatus?.(null);
    void api.goLive();
  }

  return {
    setSnap(on) {
      snap = on;
    },
    onCursor(cursor, enabled) {
      if (!enabled || cursor.mode === "live") {
        goLive();
        return;
      }
      pendingT = cursor.t;
      if (!raf) raf = requestAnimationFrame(flush);
      // Hidden/backgrounded tabs never fire rAF; whichever fires first wins.
      if (fallbackTimer === null) fallbackTimer = setTimeout(flush, 32);
    },
    goLive,
    dispose: () => {
      offIngest();
      goLive();
    },
  };
}
