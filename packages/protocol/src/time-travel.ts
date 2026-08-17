import type { ComponentId, RenderId } from "./ids.js";

/**
 * One unit of a time-travel apply set: restore `componentId` to the raw state
 * it had at `renderId`. The raw values never cross this boundary — they live
 * in the page runtime's state history, keyed by renderId.
 */
export interface TimeTravelEntry {
  componentId: ComponentId;
  renderId: RenderId;
}

/**
 * Why one apply-set entry could not be restored:
 * - "no-history": the raw state at that renderId is no longer retained.
 * - "no-fiber": the component is not mounted anymore.
 * - "shape-mismatch": the hook list changed since capture (e.g. hot reload).
 * - "write-failed": the renderer refused the override write.
 */
export type TimeTravelFailureReason = "no-history" | "no-fiber" | "shape-mismatch" | "write-failed";

export interface TimeTravelFailure {
  componentId: ComponentId;
  renderId: RenderId;
  reason: TimeTravelFailureReason;
}

/**
 * Opt-in seam for state living outside React (Zustand, Redux, TanStack Query,
 * module singletons). The page registers adapters; snapshots are captured per
 * commit and restored alongside component state when the cursor moves. Values
 * never leave the page.
 */
export interface TimeTravelStoreAdapter {
  /** Stable identifier, unique per registered store. */
  id: string;
  /** An immutable (or safely re-applicable) snapshot of the store's state. */
  getSnapshot(): unknown;
  applySnapshot(snapshot: unknown): void;
}

/**
 * Why one registered store could not be restored:
 * - "no-snapshot": nothing was captured at or before the cursor time (the store
 *   registered later, or its snapshot ring evicted that far back).
 * - "snapshot-failed": `getSnapshot` threw while taking the live baseline.
 * - "apply-failed": `applySnapshot` threw.
 */
export type TimeTravelStoreFailureReason = "no-snapshot" | "snapshot-failed" | "apply-failed";

export interface TimeTravelStoreFailure {
  storeId: string;
  reason: TimeTravelStoreFailureReason;
}

export interface TimeTravelResult {
  /** Components restored. Registered stores are counted by `storesApplied`. */
  applied: number;
  /** Components that could not be restored — one per entry in `failures`. */
  failed: number;
  /** False when the renderer lacks the dev-only override API (prod builds). */
  supported: boolean;
  /** One entry per failed apply-set entry; empty when everything applied. */
  failures: TimeTravelFailure[];
  /** Registered stores restored to the cursor time. */
  storesApplied: number;
  /** One entry per store that could not be restored; empty when all applied. */
  storeFailures: TimeTravelStoreFailure[];
}

/**
 * Shared retention contract: the page-side raw-state history and the panel's
 * render ring must agree, or deep scrubs fail silently on one side only.
 */
export const TIME_TRAVEL_RETENTION = {
  rendersPerComponent: 100,
  maxComponents: 200,
  /** Snapshots kept per registered store adapter. */
  snapshotsPerStore: 200,
} as const;
