/**
 * Intra-lane stacking: overlapping clips get distinct row indices (columns).
 * Never collapse rows onto each other — depth grows with concurrency.
 */

export interface Stackable {
  t0: number;
  t1: number;
  /** Assigned by assignStacks. */
  row?: number;
}

/**
 * Assign `row` on each clip (0-based). Time-overlapping clips always get
 * distinct rows so stack-mode paint never overlaps.
 * Returns max depth per lane key.
 */
export function assignStacks<T extends Stackable>(
  byLane: ReadonlyMap<string, readonly T[]>,
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
      c.row = r;
      maxRow = Math.max(maxRow, r);
    }
    depth.set(lane, maxRow + 1);
  }
  return depth;
}

/** Stack depth for a single lane's clips (mutates `row`). */
export function stackLane<T extends Stackable>(clips: T[]): number {
  const m = new Map([["_", clips]]);
  return assignStacks(m).get("_") ?? 1;
}
