/** Shared clip geometry. Paint and hit testing consume the same rectangles. */
import type { Clip } from "../model/lanes.js";
import type { LaneLayout } from "../model/rows.js";
import { WAVE_MIN_MS } from "../model/wave.js";
import {
  LANE_PAD,
  MIN_HIT_TARGET_PX,
  MIN_VISUAL_EVENT_PX,
  ROW_H,
  TICK_THRESHOLD_PX,
} from "./metrics.js";

export interface RectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClipRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  clip: Clip;
  wave?: boolean;
  visual: RectGeometry;
  hit: RectGeometry;
  representation: "tick" | "clip" | "wave";
}

export interface ClipRectProjectors {
  wToX: (t: number) => number;
}

export function buildClipRect(
  clip: Clip,
  x0: number,
  y: number,
  height: number,
  trueWidth: number,
): ClipRect {
  const representation = trueWidth < TICK_THRESHOLD_PX ? "tick" : "clip";
  const visualWidth =
    representation === "tick"
      ? Math.max(1, Math.min(TICK_THRESHOLD_PX, Math.max(trueWidth, MIN_VISUAL_EVENT_PX)))
      : Math.max(trueWidth, MIN_VISUAL_EVENT_PX);
  const center = x0 + visualWidth / 2;
  const hitWidth = Math.max(MIN_HIT_TARGET_PX, visualWidth);
  const visual = { x: x0, y, width: visualWidth, height };
  const hit = { x: center - hitWidth / 2, y: y - 3, width: hitWidth, height: height + 6 };
  return {
    x0: visual.x,
    x1: visual.x + visual.width,
    y0: visual.y,
    y1: visual.y + visual.height,
    clip,
    visual,
    hit,
    representation,
  };
}

export function buildWaveRect(clip: Clip, centerX: number, centerY: number): ClipRect {
  const visual = { x: centerX - 1, y: centerY - 8, width: 2, height: 16 };
  const hit = {
    x: centerX - MIN_HIT_TARGET_PX / 2,
    y: centerY - 11,
    width: MIN_HIT_TARGET_PX,
    height: 22,
  };
  return {
    x0: visual.x,
    x1: visual.x + visual.width,
    y0: visual.y,
    y1: visual.y + visual.height,
    clip,
    wave: true,
    visual,
    hit,
    representation: "wave",
  };
}

export function computeClipRects(
  layout: LaneLayout,
  proj: ClipRectProjectors,
): { clipRects: Map<string, ClipRect>; snapEdges: number[] } {
  const { wToX } = proj;
  const clipRects = new Map<string, ClipRect>();
  const snapEdges: number[] = [];

  for (const row of layout.rows) {
    if (row.mode === "wave") {
      const mid = row.y + row.h / 2;
      for (const c of row.clips) {
        if (c.aggregate) continue;
        const xc = wToX(c.t0 + Math.max(c.self, WAVE_MIN_MS) / 2);
        clipRects.set(String(c.renderId), buildWaveRect(c, xc, mid));
        snapEdges.push(c.t0, c.t1);
      }
      continue;
    }

    for (const c of row.clips) {
      if (c.aggregate) continue;
      const x0 = wToX(c.t0);
      const x1 = wToX(c.t1);
      const clipH = ROW_H - 6;
      const cy = row.y + LANE_PAD / 2 + (c.row ?? 0) * ROW_H + 1.5;
      clipRects.set(String(c.renderId), buildClipRect(c, x0, cy, clipH, Math.max(0, x1 - x0)));
      snapEdges.push(c.t0, c.t1);
    }
  }

  return { clipRects, snapEdges };
}
