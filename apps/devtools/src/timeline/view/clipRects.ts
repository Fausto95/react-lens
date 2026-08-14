/**
 * Clip port geometry — pure, canvas-free.
 *
 * Ports are computed for EVERY clip, on-screen or not: causal arrows must keep
 * their anchors when an endpoint scrolls past the stage edge, so viewport
 * culling belongs to painting, never to port registration.
 */

import type { Clip } from "../model/lanes.js";
import type { LaneLayout } from "../model/rows.js";
import { WAVE_MIN_MS } from "../model/wave.js";
import { LANE_PAD, MIN_CLIP_PX, ROW_H } from "./metrics.js";

export interface ClipRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  clip: Clip;
  /** True when the port is a wave-lane stand-in (no stack bar). */
  wave?: boolean;
}

export interface ClipRectProjectors {
  wToX: (t: number) => number;
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
        // Aim at the painted histogram span [t0, t0 + self] — the inclusive
        // midpoint floats past the drawn column when total covers a cascade.
        const xc = wToX(c.t0 + Math.max(c.self, WAVE_MIN_MS) / 2);
        clipRects.set(String(c.renderId), {
          x0: xc - 3,
          x1: xc + 3,
          y0: mid - 8,
          y1: mid + 8,
          clip: c,
          wave: true,
        });
        snapEdges.push(c.t0, c.t1);
      }
      continue;
    }

    for (const c of row.clips) {
      if (c.aggregate) continue;
      const x0 = wToX(c.t0);
      const x1 = wToX(c.t1);
      const w = Math.max(x1 - x0, MIN_CLIP_PX);
      const clipH = ROW_H - 6;
      const cy = row.y + LANE_PAD / 2 + (c.row ?? 0) * ROW_H + 1.5;
      clipRects.set(String(c.renderId), { x0, x1: x0 + w, y0: cy, y1: cy + clipH, clip: c });
      snapEdges.push(c.t0, c.t1);
    }
  }

  return { clipRects, snapEdges };
}
