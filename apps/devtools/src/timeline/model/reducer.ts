import type { RenderId } from "@reactlens/protocol";
import type { LaneKey } from "../../laneFilter.js";
import {
  SCALE_MAX,
  SCALE_MIN,
  clamp,
  fitPlan,
  projectT,
  projectX,
  type TimeSpan,
} from "./scale.js";
import {
  clampScroll,
  resolveZoom,
  viewportScale,
  type ActiveSpans,
  type Bounds,
  type Viewport,
} from "./viewport.js";

/**
 * Every timeline interaction, as a pure state transition.
 *
 * Zoom anchoring, clamping, region normalisation and fit-to-range are the
 * parts that were previously only reachable by clicking in a browser — and
 * they are exactly the parts that kept regressing. Here they are ordinary
 * functions with unit tests that run in milliseconds.
 */

export interface TimelineState {
  viewport: Viewport;
  selectedRender: RenderId | null;
  selectedLane: LaneKey | null;
  expandedLanes: ReadonlySet<LaneKey>;
  /** In/out points that scope the footer stats and bound replay. */
  region: TimeSpan | null;
  playing: boolean;
}

/**
 * Session facts the reducer needs to compute geometry. Passed in rather than
 * stored, because they are owned by the trace store and change as it ingests —
 * duplicating them into reducer state would create a second source of truth.
 */
export interface TimelineContext {
  bounds: Bounds;
  active: ActiveSpans;
}

export type TimelineAction =
  | { type: "measure"; width: number }
  | { type: "zoomBy"; factor: number; anchorX?: number }
  | { type: "zoomTo"; pxPerMs: number; anchorX?: number }
  | { type: "fit" }
  | { type: "fitRange"; span: TimeSpan }
  | { type: "scrolled"; scrollLeft: number }
  | { type: "panBy"; dx: number }
  | { type: "selectClip"; renderId: RenderId; laneKey: LaneKey }
  | { type: "selectLane"; laneKey: LaneKey | null }
  | { type: "toggleLane"; key: LaneKey }
  | { type: "expandLanes"; keys: readonly LaneKey[] }
  | { type: "setRegion"; span: TimeSpan | null }
  | { type: "dragRegionEdge"; side: "start" | "end"; t: number }
  | { type: "play" }
  | { type: "pause" };

export function initialTimelineState(over: Partial<TimelineState> = {}): TimelineState {
  return {
    viewport: { zoom: "fit", scrollLeft: 0, width: 800 },
    selectedRender: null,
    selectedLane: null,
    expandedLanes: new Set(),
    region: null,
    playing: false,
    ...over,
  };
}

/** Order a span low→high so a backwards drag is still a valid region. */
function normalise(span: TimeSpan): TimeSpan {
  return span.start <= span.end ? span : { start: span.end, end: span.start };
}

export function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
  ctx: TimelineContext,
): TimelineState {
  const scaleNow = () => viewportScale(state.viewport, ctx.bounds, ctx.active);

  switch (action.type) {
    case "measure": {
      // A hidden or unmounted panel measures 0; adopting it would collapse the
      // scale and strand the user when the panel comes back.
      if (action.width <= 0 || action.width === state.viewport.width) return state;
      const viewport = { ...state.viewport, width: action.width };
      const scale = viewportScale(viewport, ctx.bounds, ctx.active);
      return {
        ...state,
        viewport: {
          ...viewport,
          scrollLeft: clampScroll(viewport.scrollLeft, scale, action.width),
        },
      };
    }

    case "zoomTo":
    case "zoomBy": {
      const width = state.viewport.width;
      const anchorX = action.anchorX ?? width / 2;
      const before = scaleNow();
      // The time under the anchor must not move. Capture it first, then solve
      // the scroll offset that puts it back under the same pixel.
      const anchorT = projectT(before.segs, state.viewport.scrollLeft + anchorX);
      const current = resolveZoom(state.viewport, ctx.bounds, ctx.active);
      const zoom = clamp(
        action.type === "zoomTo" ? action.pxPerMs : current * action.factor,
        SCALE_MIN,
        SCALE_MAX,
      );
      const viewport: Viewport = { ...state.viewport, zoom };
      const after = viewportScale(viewport, ctx.bounds, ctx.active);
      const scrollLeft = clampScroll(projectX(after.segs, anchorT) - anchorX, after, width);
      return { ...state, viewport: { ...viewport, scrollLeft } };
    }

    case "fit":
      return { ...state, viewport: { ...state.viewport, zoom: "fit", scrollLeft: 0 } };

    case "fitRange": {
      const plan = fitPlan(
        ctx.active as Array<[number, number]>,
        ctx.bounds,
        normalise(action.span),
        state.viewport.width,
      );
      const viewport: Viewport = { ...state.viewport, zoom: plan.scale };
      const scale = viewportScale(viewport, ctx.bounds, ctx.active);
      return {
        ...state,
        viewport: {
          ...viewport,
          scrollLeft: clampScroll(plan.scrollLeft, scale, state.viewport.width),
        },
      };
    }

    case "scrolled": {
      const scrollLeft = clampScroll(action.scrollLeft, scaleNow(), state.viewport.width);
      if (scrollLeft === state.viewport.scrollLeft) return state;
      return { ...state, viewport: { ...state.viewport, scrollLeft } };
    }

    case "panBy": {
      const scrollLeft = clampScroll(
        state.viewport.scrollLeft + action.dx,
        scaleNow(),
        state.viewport.width,
      );
      if (scrollLeft === state.viewport.scrollLeft) return state;
      return { ...state, viewport: { ...state.viewport, scrollLeft } };
    }

    case "selectClip":
      return { ...state, selectedRender: action.renderId, selectedLane: action.laneKey };

    case "selectLane":
      return { ...state, selectedLane: action.laneKey };

    case "toggleLane": {
      const next = new Set(state.expandedLanes);
      if (!next.delete(action.key)) next.add(action.key);
      return { ...state, expandedLanes: next };
    }

    case "expandLanes": {
      // Identity-stable when nothing changes, so an effect that expands the
      // lanes a cascade touches cannot re-trigger itself forever.
      if (action.keys.every((k) => state.expandedLanes.has(k))) return state;
      const next = new Set(state.expandedLanes);
      for (const key of action.keys) next.add(key);
      return { ...state, expandedLanes: next };
    }

    case "setRegion":
      return { ...state, region: action.span ? normalise(action.span) : null };

    case "dragRegionEdge": {
      if (!state.region) return state;
      return { ...state, region: normalise({ ...state.region, [action.side]: action.t }) };
    }

    case "play":
      return state.playing ? state : { ...state, playing: true };

    case "pause":
      return state.playing ? { ...state, playing: false } : state;
  }
}
