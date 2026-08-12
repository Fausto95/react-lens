/**
 * Shared pixel / layout constants for the canvas timeline.
 * Match SynthesisTimelinePro so draw, DOM chrome, and hit-testing agree.
 */

export const RULER_H = 30;
export const WALL_H = 15;
export const NAV_H = 28;
export const SHELF_H = 27;
export const ROW_H = 22;
export const LANE_PAD = 10;
export const WAVE_H = 44;
export const QUIET_MAX = 2;
/**
 * Inclusive ms budget for a "quiet" lane. Sparse lanes that still cover a
 * real cascade (App once at 40 ms total) stay on stage; Tooltip/Analytics
 * with a couple of sub‑ms renders go to the shelf.
 */
export const QUIET_TOTAL_MS = 8;
export const STACK_MAX = 4;
export const SNAP_PX = 5;
export const IDLE_MS = 200;
/** Collapsed gap axis length: log-scaled between these bounds (ms → axis units). */
export const GAP_AXIS_MIN = 26;
export const GAP_AXIS_MAX = 110;

/** Name gutter width (clamped from stage width). */
export const NAME_W_MIN = 88;
export const NAME_W_MAX = 150;
export const NAME_W_FRAC = 0.14;

/** Default name gutter when unmeasured. */
export const NAME_W = 148;

export const MIN_CLIP_PX = 2;
export const CLIP_LABEL_MIN_PX = 48;
/** Floor on the axis view span — stop zooming in past this (axis units ≈ ms on activity). */
export const VIEW_SPAN_MIN = 5;
/**
 * Ceiling on the axis view span — allow zooming out past the session
 * (empty margins). Effective max is `max(axis.total, VIEW_SPAN_MAX)`.
 */
export const VIEW_SPAN_MAX = 12_400;

export const ACCENT = "#6E9BFF";
export const CAUSE_COLOR = {
  state: "#3ECF8E",
  props: "#4C8DFF",
  context: "#A78BFA",
  cascade: "#7A7A85",
} as const;

export const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';

export function nameWidthFor(stageW: number): number {
  return Math.max(NAME_W_MIN, Math.min(NAME_W_MAX, Math.round(stageW * NAME_W_FRAC)));
}
