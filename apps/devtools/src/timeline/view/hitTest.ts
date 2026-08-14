import type { ClipRect, RectGeometry } from "./clipRects.js";

export interface TimelinePoint {
  x: number;
  y: number;
}

function contains(rect: RectGeometry, point: TimelinePoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function hitTestClipRects(
  point: TimelinePoint,
  candidates: Iterable<ClipRect>,
): ClipRect | null {
  let best: ClipRect | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const rect of candidates) {
    if (!contains(rect.hit, point)) continue;
    const insideVisual = contains(rect.visual, point);
    const cx = rect.visual.x + rect.visual.width / 2;
    const cy = rect.visual.y + rect.visual.height / 2;
    const score =
      (insideVisual ? -1000 : 0) + Math.abs(point.x - cx) + Math.abs(point.y - cy) * 0.25;
    if (score < bestScore) {
      bestScore = score;
      best = rect;
    }
  }
  return best;
}
