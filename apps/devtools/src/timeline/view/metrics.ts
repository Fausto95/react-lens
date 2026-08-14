/** Shared pixel / layout constants for the canvas timeline. */
export const RULER_H = 40;
export const WALL_H = 18;
export const NAV_H = 28;
export const SHELF_H = 27;
export const ROW_H = 24;
export const LANE_PAD = 10;
export const WAVE_H = 44;
export const QUIET_MAX = 2;
export const QUIET_TOTAL_MS = 8;
export const STACK_MAX = 4;
/**
 * Fixed virtual lane slot. Reserve enough vertical room for the engine's stack
 * rows so overlapping renders are shown on separate tracks instead of being
 * folded onto two visual rows.
 */
export const VIRTUAL_ROW_H = LANE_PAD + STACK_MAX * ROW_H;
export const VIRTUAL_OVERSCAN_ROWS = 6;
export const SNAP_PX = 5;
export const IDLE_MS = 200;
export const GAP_AXIS_SEAM = 0;
export const NAME_W_MIN = 104;
export const NAME_W_MAX = 180;
export const NAME_W_FRAC = 0.16;
export const NAME_W = 156;

/** Paint truthful time widths; only hit geometry gets widened. */
export const MIN_VISUAL_EVENT_PX = 0.75;
export const TICK_THRESHOLD_PX = 2;
export const MIN_HIT_TARGET_PX = 10;
export const CLIP_SHORT_LABEL_PX = 18;
export const CLIP_CAUSE_LABEL_PX = 34;
export const CLIP_FULL_LABEL_PX = 72;
export const CLIP_LABEL_GAP_PX = 8;
/** Compatibility aliases for older tests/callers. */
export const MIN_CLIP_PX = TICK_THRESHOLD_PX;
export const CLIP_LABEL_MIN_PX = CLIP_CAUSE_LABEL_PX;

/** Restore the original inspection zoom floor. */
export const VIEW_SPAN_MIN = 5;
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
