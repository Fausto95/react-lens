import type { Clip } from "./lanes.js";

/**
 * Turning a lane's clips into boxes that do not sit on top of each other.
 *
 * A clip's box is `[x(t0), x(t1)]` widened to a legibility floor, because a
 * sub-millisecond render is a fraction of a pixel on a multi-second axis. That
 * floor is what makes short renders visible — and, applied clip by clip, what
 * made them illegible: four renders microseconds apart each became a 4px box
 * on ~2px of real span, so they drew over one another as a single smear that
 * could not be read or clicked.
 *
 * The floor cannot be applied to one clip without looking at its neighbours.
 * So this is a single pass over the lane: anything that would collide is drawn
 * as one **cluster** carrying its count, and zooming in resolves it back into
 * separate clips once there is room.
 */

/**
 * Legibility floor for a box, in px. A sub-millisecond render would otherwise
 * be invisible.
 */
export const MIN_CLIP_PX = 4;

/**
 * Clear space required between neighbouring boxes. Touching boxes read as one
 * long clip; this gap is what makes four renders countable at a glance.
 */
export const CLUSTER_GAP_PX = 2;

/** A single render, drawn on its own. */
export interface PlacedClip {
  kind: "clip";
  left: number;
  width: number;
  clip: Clip;
  /** Always the one clip — so callers can treat both shapes uniformly. */
  clips: Clip[];
}

/** Several renders too close to separate at this scale. */
export interface PlacedCluster {
  kind: "cluster";
  left: number;
  width: number;
  clips: Clip[];
}

export type Placed = PlacedClip | PlacedCluster;

/** The heaviest render in a cluster — what the inspector shows when picked. */
export function dominantClip(clips: readonly Clip[]): Clip | undefined {
  let best: Clip | undefined;
  for (const clip of clips) if (!best || clip.self > best.self) best = clip;
  return best;
}

/**
 * Lay a lane's clips out left to right, merging any that would collide.
 *
 * `xOf` is the projection in force, so the result follows the current zoom:
 * the same clips cluster when the axis is coarse and separate when it is not.
 */
export function placeClips(clips: readonly Clip[], xOf: (t: number) => number): Placed[] {
  if (clips.length === 0) return [];
  const ordered = [...clips].sort((a, b) => a.t0 - b.t0);

  const out: Placed[] = [];
  for (const clip of ordered) {
    const left = xOf(clip.t0);
    const width = Math.max(MIN_CLIP_PX, xOf(clip.t1) - left);
    const prev = out.at(-1);

    if (prev && left < prev.left + prev.width + CLUSTER_GAP_PX) {
      // Collides with what is already drawn: absorb it. The box grows to cover
      // the new clip, so nothing inside a cluster is drawn outside it.
      const merged: PlacedCluster = {
        kind: "cluster",
        left: prev.left,
        width: Math.max(prev.width, left + width - prev.left),
        clips: [...prev.clips, clip],
      };
      out[out.length - 1] = merged;
      continue;
    }

    out.push({ kind: "clip", left, width, clip, clips: [clip] });
  }
  return out;
}
