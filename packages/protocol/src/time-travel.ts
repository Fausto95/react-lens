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

export interface TimeTravelResult {
  applied: number;
  failed: number;
  /** False when the renderer lacks the dev-only override API (prod builds). */
  supported: boolean;
}
