import type { Clip } from "../model/lanes.js";
import {
  CLIP_CAUSE_LABEL_PX,
  CLIP_FULL_LABEL_PX,
  CLIP_LABEL_GAP_PX,
  CLIP_SHORT_LABEL_PX,
} from "./metrics.js";

export interface LabelSpan {
  left: number;
  right: number;
}

export function labelForClip(width: number, clip: Clip): string | null {
  if (width < CLIP_SHORT_LABEL_PX) return null;
  const cause = String(clip.cause);
  if (width < CLIP_CAUSE_LABEL_PX) return cause.slice(0, 1).toUpperCase();
  if (width < CLIP_FULL_LABEL_PX) return cause;
  return `${cause} · ${clip.total.toFixed(1)}ms`;
}

export function reserveLabelSpan(occupied: LabelSpan[], left: number, right: number): boolean {
  for (const span of occupied) {
    if (right + CLIP_LABEL_GAP_PX > span.left && left - CLIP_LABEL_GAP_PX < span.right)
      return false;
  }
  occupied.push({ left, right });
  return true;
}
