/** Shared clip geometry. Paint and hit testing consume the same rectangles. */
import type { Clip } from "../model/lanes.js";
import type { LaneLayout, LayoutRow } from "../model/rows.js";
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

export interface PackedClipRows {
  rows: ReadonlyMap<string, number>;
  depth: number;
}

interface ActiveSlot {
  end: number;
  slot: number;
}

function heapPush(heap: ActiveSlot[], value: ActiveSlot): void {
  let i = heap.length;
  heap.push(value);
  while (i > 0) {
    const parent = (i - 1) >>> 1;
    if (heap[parent]!.end <= value.end) break;
    heap[i] = heap[parent]!;
    i = parent;
  }
  heap[i] = value;
}

function heapPop(heap: ActiveSlot[]): ActiveSlot | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  let i = 0;
  while (true) {
    const left = i * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]!.end < heap[left]!.end ? right : left;
    if (heap[child]!.end >= last.end) break;
    heap[i] = heap[child]!;
    i = child;
  }
  heap[i] = last;
  return first;
}

/**
 * Interval-partitions every visible clip in a component lane.
 *
 * This deliberately ignores the engine-provided `clip.row`. That value is an
 * ingest/indexing hint and may collide after viewport projection. The visual
 * invariant is stronger: two clips whose wall-time intervals overlap can NEVER
 * occupy the same vertical slot, regardless of cause (props/state/context/etc).
 *
 * Complexity is O(n log depth) for the viewport-sized lane materialization.
 */
export function packClipRows(clips: readonly Clip[]): PackedClipRows {
  const ordered = clips
    .filter((clip) => !clip.aggregate)
    .slice()
    .sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1 || Number(a.renderId) - Number(b.renderId));
  const rows = new Map<string, number>();
  const active: ActiveSlot[] = [];
  const freeSlots: number[] = [];
  let depth = 0;

  for (const clip of ordered) {
    while (active[0] && active[0].end <= clip.t0) {
      const freed = heapPop(active)!;
      freeSlots.push(freed.slot);
    }

    const slot = freeSlots.length > 0 ? freeSlots.pop()! : depth++;
    rows.set(String(clip.renderId), slot);
    heapPush(active, { end: Math.max(clip.t1, clip.t0), slot });
  }

  return { rows, depth: Math.max(1, depth) };
}

/**
 * Maps one collision-free visual slot into the lane's fixed virtualized height.
 * Deep stacks compress vertically instead of wrapping or overlapping. Keeping
 * the outer lane height fixed preserves O(visible rows) scroll virtualization.
 */
export function stackClipVerticalGeometry(
  row: Pick<LayoutRow, "y" | "h">,
  stackRow: number,
  stackDepth: number,
): { y: number; height: number } {
  const depth = Math.max(1, stackDepth);
  const usable = Math.max(1, row.h - LANE_PAD - 3);
  const slotHeight = Math.min(ROW_H, usable / depth);
  const gap = slotHeight >= 8 ? 2 : Math.min(1, slotHeight * 0.2);
  const height = Math.max(1, Math.min(ROW_H - 6, slotHeight - gap));
  const y = row.y + LANE_PAD / 2 + stackRow * slotHeight + 1.5;
  return { y, height };
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

    const packed = packClipRows(row.clips);
    for (const c of row.clips) {
      if (c.aggregate) continue;
      const x0 = wToX(c.t0);
      const x1 = wToX(c.t1);
      const visualRow = packed.rows.get(String(c.renderId)) ?? 0;
      const vertical = stackClipVerticalGeometry(row, visualRow, packed.depth);
      clipRects.set(
        String(c.renderId),
        buildClipRect(c, x0, vertical.y, vertical.height, Math.max(0, x1 - x0)),
      );
      snapEdges.push(c.t0, c.t1);
    }
  }

  return { clipRects, snapEdges };
}
