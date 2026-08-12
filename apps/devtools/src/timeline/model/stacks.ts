/**
 * Intra-lane stacking: overlapping clips get row indices up to STACK_MAX.
 */

import { STACK_MAX } from "../view/metrics.js";

export interface Stackable {
  t0: number;
  t1: number;
  /** Assigned by assignStacks. */
  row?: number;
}

/**
 * Assign `row` on each clip (0-based, capped at STACK_MAX-1).
 * Returns max depth per lane key.
 */
export function assignStacks<T extends Stackable>(
  byLane: ReadonlyMap<string, readonly T[]>,
  stackMax = STACK_MAX,
): Map<string, number> {
  const depth = new Map<string, number>();
  for (const [lane, arr] of byLane) {
    const sorted = [...arr].sort((a, b) => a.t0 - b.t0);
    const ends: number[] = [];
    let maxRow = 0;
    for (const c of sorted) {
      let r = ends.findIndex((e) => e <= c.t0 + 0.01);
      if (r === -1) {
        r = ends.length;
        ends.push(c.t1);
      } else {
        ends[r] = c.t1;
      }
      c.row = Math.min(r, stackMax - 1);
      maxRow = Math.max(maxRow, r);
    }
    depth.set(lane, maxRow + 1);
  }
  return depth;
}

/** Stack depth for a single lane's clips (mutates `row`). */
export function stackLane<T extends Stackable>(clips: T[], stackMax = STACK_MAX): number {
  const m = new Map([["_", clips]]);
  return assignStacks(m, stackMax).get("_") ?? 1;
}
