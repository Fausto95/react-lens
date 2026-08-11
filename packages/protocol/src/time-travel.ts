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

export interface TimeTravelResult {
  applied: number;
  failed: number;
  /** False when the renderer lacks the dev-only override API (prod builds). */
  supported: boolean;
  /** One entry per failed apply-set entry; empty when everything applied. */
  failures: TimeTravelFailure[];
}

/**
 * Shared retention contract: the page-side raw-state history and the panel's
 * render ring must agree, or deep scrubs fail silently on one side only.
 */
export const TIME_TRAVEL_RETENTION = {
  rendersPerComponent: 100,
  maxComponents: 200,
} as const;
