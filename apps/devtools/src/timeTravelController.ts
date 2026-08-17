import type {
  ComponentId,
  RenderId,
  TimeTravelEntry,
  TimeTravelFailureReason,
  TimeTravelResult,
  TimeTravelStoreFailureReason,
} from "@reactlens/protocol";
import { createApplySetCursor, diffApplySet, type TraceStore } from "@reactlens/trace-engine";
import { compareDom, type DiffChange } from "@reactlens/diff-engine";
import { reportError } from "./errors.js";
import type { DOMSnapshot } from "@reactlens/protocol";
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
  /**
   * The page's DOM as it stands now. Optional: without it the panel simply does
   * not verify, which is how imported sessions and older page runtimes behave.
   */
  snapshotPage?(): DOMSnapshot | undefined | Promise<DOMSnapshot | undefined>;
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
  /**
   * Where the page's paint disagrees with the DOM captured at this cursor —
   * present only when a capture close enough to `atT` exists to be evidence.
   * This is the signal that catches what the write-level report cannot: state
   * restored, paint didn't.
   */
  domMismatch?: { count: number; examples: string[] };
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
 * What differs, in the reader's terms. A diff path is a chain of child indices
 * ending in the attribute name (or `#text`), and the chain says nothing to a
 * human — the attribute does: "style ×3, #text ×6".
 */
function summarize(changes: DiffChange[]): { count: number; examples: string[] } {
  const byKind = new Map<string, number>();
  for (const change of changes) {
    const kind = String(change.path.at(-1) ?? "node");
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const examples = [...byKind]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([kind, n]) => (n > 1 ? `${kind} ×${n}` : kind));
  return { count: changes.length, examples };
}

/** How close a capture must be to the cursor to count as evidence (throttle window). */
const VERIFY_WINDOW_MS = 250;
/** Quiet period after the last scrub frame before verifying. */
const VERIFY_SETTLE_MS = 120;

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
  /** Verification runs once the scrub settles, not per frame. */
  let verifyTimer: ReturnType<typeof setTimeout> | null = null;
  let domMismatch: { count: number; examples: string[] } | undefined;

  function publish(atT: number): void {
    onStatus?.({
      atT,
      applied: restoredIds.size,
      failedIds: new Map(failedIds),
      storesApplied,
      storeFailures: new Map(storeFailures),
      ...(domMismatch ? { domMismatch } : {}),
    });
  }

  /**
   * Compare the page's paint against what was captured at `t`. Commit DOM is
   * throttled, so only a snapshot taken near the cursor counts as evidence —
   * anything further away would report the app's own progress as a failure.
   */
  function scheduleVerify(t: number): void {
    if (!api.snapshotPage) return;
    if (verifyTimer !== null) clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      verifyTimer = null;
      const expected = store.commitDomAt(t);
      if (!expected || Math.abs(expected.timestamp - t) > VERIFY_WINDOW_MS) return;
      const epoch = travelEpoch;
      void Promise.resolve(api.snapshotPage!())
        .then((actual) => {
          if (!actual || epoch !== travelEpoch) return;
          const changes = compareDom(expected.dom, actual);
          domMismatch = changes.length > 0 ? summarize(changes) : undefined;
          publish(t);
        })
        .catch((err: unknown) => {
          // Verification is a diagnostic and must never break travel — but a
          // silent catch here already hid one real bug, so it reports.
          reportError("restore-verify", err);
        });
    }, VERIFY_SETTLE_MS);
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
    scheduleVerify(t);
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
    if (verifyTimer !== null) {
      clearTimeout(verifyTimer);
      verifyTimer = null;
    }
    domMismatch = undefined;
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
