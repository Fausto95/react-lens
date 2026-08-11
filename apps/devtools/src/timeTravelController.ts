import type {
  ComponentId,
  RenderId,
  TimeTravelEntry,
  TimeTravelFailureReason,
  TimeTravelResult,
} from "@react-lens/protocol";
import { createApplySetCursor, diffApplySet, type TraceStore } from "@react-lens/trace-engine";
import type { TimeCursor } from "./timeCursor.js";

/**
 * Page-facing time-travel commands. Synchronous in the embedded runtime,
 * promise-based over the extension's port channel.
 */
export interface TimeTravelApi {
  supported(): boolean | Promise<boolean>;
  /** `atT` lets the page also rewind registered external-store adapters. */
  apply(entries: TimeTravelEntry[], atT?: number): TimeTravelResult | Promise<TimeTravelResult>;
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
}

export interface PanelTimeTravel {
  /** Feed every cursor change; applies state deltas while historical + enabled. */
  onCursor(cursor: TimeCursor, enabled: boolean): void;
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
  /** Monotonic apply generation; results arriving out of order are dropped. */
  let generation = 0;
  let lastProcessed = 0;

  function publish(atT: number): void {
    onStatus?.({ atT, applied: restoredIds.size, failedIds: new Map(failedIds) });
  }

  function ingestResult(gen: number, t: number, delta: TimeTravelEntry[], result: TimeTravelResult): void {
    if (gen <= lastProcessed) return; // stale — a newer apply already reported
    lastProcessed = gen;
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
    Promise.resolve()
      .then(() => api.apply(delta, t))
      .then(
        (result) => ingestResult(gen, t, delta, result),
        () =>
          // Transport death (e.g. extension port closed): nothing landed.
          ingestResult(gen, t, delta, {
            applied: 0,
            failed: delta.length,
            supported: true,
            failures: delta.map((e) => ({ ...e, reason: "write-failed" as const })),
          }),
      );
  }

  function goLive(): void {
    unschedule();
    pendingT = null;
    lastApplied = new Map();
    restoredIds.clear();
    failedIds.clear();
    generation++;
    lastProcessed = generation; // in-flight results are now stale
    if (!traveling) return;
    traveling = false;
    onStatus?.(null);
    void api.goLive();
  }

  return {
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
