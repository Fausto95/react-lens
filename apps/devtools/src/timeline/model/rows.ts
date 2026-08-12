/**
 * Vertical layout: stack / wave rows, with quiet lanes tucked into the shelf.
 */

import type { LaneKey } from "../../laneFilter.js";
import type { Clip, Lane } from "./lanes.js";
import { laneMode, type LaneMode } from "./wave.js";
import {
  LANE_PAD,
  QUIET_MAX,
  QUIET_TOTAL_MS,
  ROW_H,
  RULER_H,
  STACK_MAX,
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
 * Quiet = sparse *and* little inclusive work. Clip-count alone would shelf
 * App after a single cascade root render once bars use totalDuration.
 */
export function isQuietLane(
  lane: Lane,
  quietMax = QUIET_MAX,
  quietTotalMs = QUIET_TOTAL_MS,
): boolean {
  if (lane.clips.length === 0) return true;
  if (lane.clips.length > quietMax) return false;
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
    const depth = Math.min(laneDepth.get(lane.key) ?? 1, STACK_MAX);
    // Wave LOD keys off exclusive width — inclusive parents look wide even when
    // the lane is a dense leaf stack that should histogram.
    const avgPx =
      clips.length > 0
        ? (clips.reduce((a, c) => a + c.self, 0) / clips.length) * opts.pxPerMs
        : 99;
    const rawDepth = laneDepth.get(lane.key) ?? 1;
    const mode = laneMode(rawDepth, clips.length, avgPx);
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
