import type { ComponentId, RenderId, TimeTravelEntry, TimeTravelResult } from "@react-lens/protocol";
import { applySetAt, diffApplySet, type TraceStore } from "@react-lens/trace-engine";
import type { TimeCursor } from "./timeCursor.js";

/**
 * Page-facing time-travel commands. Synchronous in the embedded runtime,
 * promise-based over the extension's port channel — the controller treats
 * both as fire-and-forget.
 */
export interface TimeTravelApi {
  supported(): boolean | Promise<boolean>;
  apply(entries: TimeTravelEntry[]): TimeTravelResult | Promise<TimeTravelResult>;
  goLive(): TimeTravelResult | Promise<TimeTravelResult>;
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
 * only the delta against what was last applied.
 */
export function createPanelTimeTravel(store: TraceStore, api: TimeTravelApi): PanelTimeTravel {
  let lastApplied = new Map<ComponentId, RenderId>();
  let pendingT: number | null = null;
  let raf = 0;
  let traveling = false;

  function flush(): void {
    raf = 0;
    if (pendingT === null) return;
    const t = pendingT;
    pendingT = null;
    const next = applySetAt(store, t);
    const delta = diffApplySet(lastApplied, next);
    lastApplied = next;
    if (delta.length > 0) {
      traveling = true;
      void api.apply(delta);
    }
  }

  function goLive(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    pendingT = null;
    lastApplied = new Map();
    if (!traveling) return;
    traveling = false;
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
    },
    goLive,
    dispose: goLive,
  };
}
