/**
 * Timeline UI state transitions — view window, selection, region, transport,
 * shelf, gap expand targets, help.
 */

import type { RenderId } from "@reactlens/protocol";
import type { LaneKey } from "../../laneFilter.js";
import { clamp, type TimeAxis, type TimeSpan } from "./axis.js";
import {
  clampView,
  fitView,
  fitWallRange,
  zoomView,
  type Bounds,
  type ViewWindow,
} from "./viewport.js";
import { VIEW_SPAN_MIN } from "../view/metrics.js";

export interface TimelineState {
  /** Axis view window. */
  view: ViewWindow;
  /** Measured stage width (full, including name gutter). */
  width: number;
  selectedRender: RenderId | null;
  selectedLane: LaneKey | null;
  /** In/out points that scope stats and bound transport. */
  region: TimeSpan | null;
  playing: boolean;
  playDir: 1 | -1;
  speed: number;
  /** Gap ids the user wants expanded (progress animates toward 1). */
  expandedGaps: ReadonlySet<string>;
  shelfOpen: boolean;
  showHelp: boolean;
}

export interface TimelineContext {
  bounds: Bounds;
  /** Live axis for clamping view ops. */
  axis: TimeAxis;
}

export type TimelineAction =
  | { type: "measure"; width: number }
  | { type: "setView"; a0: number; span: number }
  | { type: "zoomBy"; factor: number; anchorA: number }
  | { type: "fit" }
  | { type: "fitWall"; w0: number; w1: number }
  | { type: "panBy"; dA: number }
  | { type: "selectClip"; renderId: RenderId; laneKey: LaneKey }
  | { type: "selectLane"; laneKey: LaneKey | null }
  | { type: "setRegion"; span: TimeSpan | null }
  | { type: "dragRegionEdge"; side: "start" | "end"; t: number }
  | { type: "play"; dir?: 1 | -1; speed?: number }
  | { type: "pause" }
  | { type: "setSpeed"; speed: number }
  | { type: "toggleGap"; id: string }
  | { type: "toggleShelf" }
  | { type: "toggleHelp" }
  | { type: "setHelp"; open: boolean };

export function initialTimelineState(over: Partial<TimelineState> = {}): TimelineState {
  return {
    view: { a0: 0, a1: 1000 },
    width: 900,
    selectedRender: null,
    selectedLane: null,
    region: null,
    playing: false,
    playDir: 1,
    speed: 1,
    expandedGaps: new Set(),
    shelfOpen: false,
    showHelp: false,
    ...over,
  };
}

function normalise(span: TimeSpan): TimeSpan {
  return span.start <= span.end ? span : { start: span.end, end: span.start };
}

export function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
  ctx: TimelineContext,
): TimelineState {
  const total = Math.max(VIEW_SPAN_MIN, ctx.axis.total);

  switch (action.type) {
    case "measure": {
      if (action.width <= 0 || action.width === state.width) return state;
      return { ...state, width: action.width };
    }

    case "setView":
      return { ...state, view: clampView(action.a0, action.span, total) };

    case "zoomBy":
      return {
        ...state,
        view: zoomView(state.view, action.factor, action.anchorA, total),
      };

    case "fit":
      return { ...state, view: fitView(total) };

    case "fitWall":
      return { ...state, view: fitWallRange(ctx.axis, action.w0, action.w1) };

    case "panBy": {
      const span = state.view.a1 - state.view.a0;
      return { ...state, view: clampView(state.view.a0 + action.dA, span, total) };
    }

    case "selectClip":
      return { ...state, selectedRender: action.renderId, selectedLane: action.laneKey };

    case "selectLane":
      return { ...state, selectedLane: action.laneKey };

    case "setRegion":
      return { ...state, region: action.span ? normalise(action.span) : null };

    case "dragRegionEdge": {
      if (!state.region) return state;
      return { ...state, region: normalise({ ...state.region, [action.side]: action.t }) };
    }

    case "play":
      return {
        ...state,
        playing: true,
        playDir: action.dir ?? state.playDir,
        speed: action.speed ?? state.speed,
      };

    case "pause":
      return state.playing ? { ...state, playing: false } : state;

    case "setSpeed":
      return { ...state, speed: clamp(action.speed, 0.25, 8) };

    case "toggleGap": {
      const next = new Set(state.expandedGaps);
      if (!next.delete(action.id)) next.add(action.id);
      return { ...state, expandedGaps: next };
    }

    case "toggleShelf":
      return { ...state, shelfOpen: !state.shelfOpen };

    case "toggleHelp":
      return { ...state, showHelp: !state.showHelp };

    case "setHelp":
      return state.showHelp === action.open ? state : { ...state, showHelp: action.open };
  }
}
