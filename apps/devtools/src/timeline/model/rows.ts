/**
 * Vertical layout: stack / wave rows, with quiet lanes tucked into the shelf.
 */

import type { LaneKey } from "../../laneFilter.js";
import type { Clip, Lane } from "./lanes.js";
import { avgClipWidthPx, laneMode, type LaneMode } from "./wave.js";
import {
  LANE_PAD,
  QUIET_MAX,
  QUIET_TOTAL_MS,
  ROW_H,
  RULER_H,
  WAVE_H,
} from "../view/metrics.js";

export interface LayoutRow {
  lane: Lane;
  key: LaneKey;
  y: number;
  h: number;
  mode: LaneMode;
  depth: number;
  clips: readonly Clip[];
  quiet: boolean;
  dim: boolean;
}

export interface LaneLayout {
  rows: LayoutRow[];
  totalH: number;
  quietLanes: Lane[];
}

/**
 * Quiet = negligible inclusive work on the lane. Clip count alone must not
 * keep fanout leaves (Consumer ×4) on stage when each render is sub-ms.
 */
export function isQuietLane(
  lane: Lane,
  _quietMax = QUIET_MAX,
  quietTotalMs = QUIET_TOTAL_MS,
): boolean {
  if (lane.clips.length === 0) return true;
  const inclusive = lane.clips.reduce((a, c) => a + c.total, 0);
  return inclusive < quietTotalMs;
}

/**
 * Build visible rows. Quiet lanes are omitted unless `shelfOpen`.
 * `pxPerMs` is axis-view px per axis unit (≈ active ms when gaps collapsed).
 */
export function computeLayout(
  lanes: readonly Lane[],
  laneDepth: ReadonlyMap<string, number>,
  opts: {
    shelfOpen: boolean;
    pxPerMs: number;
    isDim: (key: LaneKey) => boolean;
    quietMax?: number;
    quietTotalMs?: number;
  },
): LaneLayout {
  const quietMax = opts.quietMax ?? QUIET_MAX;
  const quietTotalMs = opts.quietTotalMs ?? QUIET_TOTAL_MS;
  const quietLanes = lanes.filter((l) => isQuietLane(l, quietMax, quietTotalMs));
  const rows: LayoutRow[] = [];
  let y = RULER_H;

  for (const lane of lanes) {
    const quiet = isQuietLane(lane, quietMax, quietTotalMs);
    if (quiet && !opts.shelfOpen) continue;

    const clips = lane.clips;
    const depth = Math.max(1, laneDepth.get(lane.key) ?? 1);
    // Painted inclusive width × pxPerMs — grows with zoom so heavy lanes
    // progressively leave wave and show stacked clips.
    const avgPx = avgClipWidthPx(clips, opts.pxPerMs);
    const mode = laneMode(depth, clips.length, avgPx);
    const h = mode === "wave" ? WAVE_H : LANE_PAD + depth * ROW_H;
    rows.push({
      lane,
      key: lane.key,
      y,
      h,
      mode,
      depth,
      clips,
      quiet,
      dim: opts.isDim(lane.key),
    });
    y += h;
  }

  return { rows, totalH: Math.max(y, RULER_H + 40), quietLanes };
}
