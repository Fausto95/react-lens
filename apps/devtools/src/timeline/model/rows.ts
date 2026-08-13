/**
 * Vertical layout: stack / wave rows, with quiet lanes tucked into the shelf.
 */

import type { LaneKey } from "../../laneFilter.js";
import type { Clip, Lane } from "./lanes.js";
import { avgClipWidthPx, laneMode, type LaneMode } from "./wave.js";
import { LANE_PAD, QUIET_MAX, QUIET_TOTAL_MS, ROW_H, RULER_H, WAVE_H } from "../view/metrics.js";

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
  if (lane.quiet !== undefined && lane.clips.length === 0) return lane.quiet;
  // Inclusive clip work in the current materialization (viewport window).
  // Lifetime selfTotal alone must not override a cascade root whose bar is wide.
  if (lane.clips.length === 0) {
    return (lane.selfTotal ?? 0) < quietTotalMs;
  }
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
    /** Visible wall window — the stack/wave choice weighs only these clips. */
    visible?: { t0: number; t1: number };
    /** Previous per-lane modes, held inside the hysteresis band. */
    prevModes?: ReadonlyMap<LaneKey, LaneMode>;
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
    // The mode weighs only clips in view: a lane dense elsewhere must still
    // resolve to stacked clips where the user actually zoomed in.
    const win = opts.visible;
    const inView = win ? clips.filter((c) => c.t1 >= win.t0 && c.t0 <= win.t1) : clips;
    const scoped = inView.length > 0 ? inView : clips;
    // Painted inclusive width × pxPerMs — grows with zoom so heavy lanes
    // progressively leave wave and show stacked clips.
    const avgPx = avgClipWidthPx(scoped, opts.pxPerMs);
    const mode =
      lane.lod === "buckets"
        ? "wave"
        : laneMode(depth, scoped.length, avgPx, opts.prevModes?.get(lane.key));
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
