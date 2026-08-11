import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import type { LaneControls } from "../../laneFilter.js";
import type { TimeCursor } from "../../timeCursor.js";
import { projectT, projectX, type TimeSpan } from "../model/scale.js";
import { visibleChunkRange, sameChunkRange, type ChunkRange } from "../model/culling.js";
import { followScroll, maxScroll, resolveZoom } from "../model/viewport.js";
import { advanceReplay, stepStop } from "../model/schedule.js";
import { timelineKeyAction } from "../keymap.js";
import { clipAtTime } from "../model/lanes.js";
import { startReplayTicker } from "../replayTicker.js";
import { useLatest } from "../../useLatest.js";
import type { Timeline as TimelineModel } from "../useTimeline.js";
import { LONG_TASK_MS } from "../useTimeline.js";
import { Ruler, rulerMarkers } from "./Ruler.js";
import { Lanes } from "./Lanes.js";
import { Arrows } from "./Arrows.js";
import { Chrome } from "./Chrome.js";
import { Footer } from "./Footer.js";
import { NAME_W } from "./metrics.js";

/** One replay pass over the whole region, in ms of wall clock. */
const REPLAY_MS = 2600;
/** A replay started near the end still needs long enough to be watchable. */
const MIN_REPLAY_MS = 700;
/** Show marker labels only when the axis is roomy enough to read them. */
const MARKER_LABEL_MIN_PX_PER_MS = 0.35;

/**
 * The timeline: ruler, lanes and footer over one horizontally scrolling
 * canvas.
 *
 * The ruler and the lanes share a single scroller, so there is exactly one
 * scroll offset for the whole view and nothing to keep in sync. The reducer
 * owns that offset; the DOM is mirrored *from* it, and a user scroll comes
 * back in as an action.
 */
export function Timeline({
  model,
  cursor,
  onCursor,
  lanes,
  fixApplied = false,
  onSelectComponent,
  onHighlight,
  transport,
}: {
  model: TimelineModel;
  cursor: TimeCursor;
  onCursor: (c: TimeCursor) => void;
  lanes?: LaneControls;
  fixApplied?: boolean;
  onSelectComponent?: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  /** Panel-owned controls rendered into the footer (travel, A/B…). */
  transport?: React.ReactNode;
}) {
  const { state, dispatch, bounds, scale, idleSegs, rows, canvasHeight, arrows } = model;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panFrom = useRef<number | null>(null);
  /** Suppresses the scroll event our own imperative write provokes. */
  const echo = useRef(false);

  const xOf = useMemo(() => (t: number) => projectX(scale.segs, t), [scale]);
  const pxPerMs = resolveZoom(state.viewport, bounds, model.active);
  /** What "fit" resolves to right now — the 100% reference for the readout. */
  const fitPxPerMs = resolveZoom({ ...state.viewport, zoom: "fit" }, bounds, model.active);

  // ── Measurement ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => dispatch({ type: "measure", width: el.clientWidth - NAME_W });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dispatch]);

  // ── Scroll: reducer → DOM, one way ────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (Math.abs(el.scrollLeft - state.viewport.scrollLeft) > 1) {
      echo.current = true;
      el.scrollLeft = state.viewport.scrollLeft;
    }
  }, [state.viewport.scrollLeft]);

  const [cull, setCull] = useState<ChunkRange>(() => visibleChunkRange(0, 800));
  useEffect(() => {
    const next = visibleChunkRange(state.viewport.scrollLeft, state.viewport.width);
    setCull((prev) => (sameChunkRange(prev, next) ? prev : next));
  }, [state.viewport.scrollLeft, state.viewport.width]);

  // ── Pointer → time ────────────────────────────────────────────────────────
  const tOfClient = (clientX: number): number => {
    const el = scrollerRef.current;
    if (!el) return bounds.t0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - NAME_W + el.scrollLeft;
    return projectT(scale.segs, Math.max(0, Math.min(scale.width, x)));
  };

  const scrub = (clientX: number) => {
    const t = tOfClient(clientX);
    onCursor({ t, mode: t >= bounds.t1 - 0.5 ? "live" : "historical" });
  };

  // ── Wheel: pan, ⌘/ctrl to zoom at the pointer ─────────────────────────────
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Continuous factor: a trackpad pinch emits many tiny deltas where a
        // fixed step feels dead, a mouse wheel emits few large ones.
        const anchorX = e.clientX - el.getBoundingClientRect().left - NAME_W;
        dispatch({ type: "zoomBy", factor: Math.exp(e.deltaY * 0.004), anchorX });
      }
      // Plain wheel falls through to native horizontal scrolling, which comes
      // back as a `scrolled` action — no custom pan maths to disagree with it.
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [dispatch]);

  // ── Transport ─────────────────────────────────────────────────────────────
  /**
   * ⏮ / ⏭ move to the adjacent commit rather than by a slice of time: between
   * commits the page's state is unchanged, so a fixed step would land on the
   * same thing twice.
   */
  const stepPlayhead = (dir: 1 | -1) => {
    const t = stepStop(model.schedule, model.replayRange, model.playhead, dir);
    onCursor({ t, mode: t >= bounds.t1 - 0.5 ? "live" : "historical" });
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  /**
   * The bindings live in `keymap.ts` as data; this only routes them. Held in a
   * ref so the listener is installed once rather than re-bound on every store
   * ingest — the same dependency that used to tear down the replay ticker.
   */
  const keyHandlerRef = useLatest((e: KeyboardEvent) => {
    const action = timelineKeyAction(e);
    if (!action) return;
    // Never steal a key from a field the user is typing into.
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    switch (action.kind) {
      case "toggle-play":
        e.preventDefault();
        dispatch(state.playing ? { type: "pause" } : { type: "play", from: model.playhead });
        break;
      case "step-commit":
        e.preventDefault();
        stepPlayhead(action.dir);
        break;
      case "fit":
        dispatch({ type: "fit" });
        break;
      case "go-live":
        onCursor({ t: bounds.t1, mode: "live" });
        break;
      case "zoom":
        dispatch({ type: "zoomBy", factor: action.factor });
        break;
      case "escape-band":
        dispatch({ type: "setRegion", span: null });
        break;
      default:
        // `step-interaction` belongs to the interaction track, not yet re-homed.
        break;
    }
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Replay ────────────────────────────────────────────────────────────────
  const onCursorRef = useLatest(onCursor);
  const scheduleRef = useLatest(model.schedule);
  const sweepRef = useLatest(model.sweep);
  /** Read when ▶ is pressed, so the ticker keeps a constant speed. */
  const fractionRef = useLatest(model.replayFraction);
  useEffect(() => {
    if (!state.playing) return;
    // How many stops the page has already been shown — the one piece of state
    // the ticker carries, so a stop can never be replayed or skipped.
    let visited = 0;
    const ticker = startReplayTicker(
      Math.max(MIN_REPLAY_MS, REPLAY_MS * fractionRef.current),
      false,
      (frac, done) => {
        const stops = scheduleRef.current;
        const step = advanceReplay(stops, sweepRef.current, frac, visited);
        visited = step.visited;
        // Emitted every frame so the playhead moves. Re-applying the same page
        // state is not wasted work: the travel controller diffs against what
        // it last applied and sends nothing when the commit has not changed.
        onCursorRef.current({ t: step.t, mode: step.live ? "live" : "historical" });
        if (done) {
          const last = stops.at(-1);
          if (last) onCursorRef.current({ t: last.t, mode: "live" });
          dispatch({ type: "pause" });
        }
      },
    );
    return () => ticker.stop();
    // Deliberately NOT keyed on the schedule or bounds: those change on every
    // store ingest, which would tear the ticker down and restart it each frame.
  }, [state.playing, dispatch]);

  /**
   * Follow the playhead while replaying. A replay whose playhead walks off the
   * edge is not showing you anything, so this is not optional.
   */
  useEffect(() => {
    if (!state.playing) return;
    const next = followScroll(
      NAME_W + xOf(model.playhead),
      state.viewport.scrollLeft,
      state.viewport.width,
      maxScroll(scale, state.viewport.width),
    );
    if (next !== null) dispatch({ type: "scrolled", scrollLeft: next });
  }, [
    state.playing,
    model.playhead,
    state.viewport.scrollLeft,
    state.viewport.width,
    scale,
    xOf,
    dispatch,
  ]);

  // Reveal the lanes a selected cascade reaches, so its arrows have targets.
  const revealKey = model.lanesToReveal.join("|");
  useEffect(() => {
    if (model.lanesToReveal.length > 0) {
      dispatch({ type: "expandLanes", keys: model.lanesToReveal });
    }
  }, [revealKey, dispatch]);

  /**
   * Scrubbing drives the inspector: as the playhead moves, adopt the clip
   * under it (preferring the lane already selected) so Cause → Change → Cost →
   * Fix follows the cursor. Skipped while live, so recording doesn't thrash.
   */
  const lastPlayhead = useRef(model.playhead);
  /**
   * The clip the user picked by hand, pinned while the playhead is still
   * inside it.
   *
   * Clicking a clip updates two owners — the timeline's reducer (selection)
   * and the panel's cursor — which can commit in separate renders. When the
   * cursor landed first, this effect ran with the *previous* selected lane, so
   * `clipAtTime` had no lane preference and adopted whatever clip happened to
   * sit nearest that instant. The click appeared to select a different clip.
   */
  const pinned = useRef<{ renderId: RenderId; t0: number; t1: number } | null>(null);
  useEffect(() => {
    if (lastPlayhead.current === model.playhead) return;
    lastPlayhead.current = model.playhead;
    if (cursor.mode === "live") return;
    const hold = pinned.current;
    if (hold && model.playhead >= hold.t0 - 0.5 && model.playhead <= hold.t1 + 0.5) return;
    pinned.current = null;
    const clip = clipAtTime(model.lanes, model.playhead, state.selectedLane);
    if (!clip || clip.renderId === state.selectedRender) return;
    dispatch({ type: "selectClip", renderId: clip.renderId, laneKey: clip.laneKey });
    onSelectComponent?.(clip.componentId);
  }, [
    model.playhead,
    model.lanes,
    cursor.mode,
    state.selectedLane,
    state.selectedRender,
    dispatch,
    onSelectComponent,
  ]);

  const markers = useMemo(
    () => rulerMarkers(model.interactions, model.commits, LONG_TASK_MS),
    [model.interactions, model.commits],
  );

  return (
    <div className="tl">
      <div
        className="lanes"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest(".clip, .lname, .rhandle")) return;
          if (e.shiftKey || e.button === 1) {
            panFrom.current = e.clientX;
            return;
          }
          scrub(e.clientX);
        }}
        onPointerMove={(e) => {
          if (panFrom.current !== null) {
            const dx = e.clientX - panFrom.current;
            panFrom.current = e.clientX;
            dispatch({ type: "panBy", dx: -dx });
            return;
          }
          if (e.buttons === 1 && !(e.target as HTMLElement).closest(".rhandle")) scrub(e.clientX);
        }}
        onPointerUp={() => {
          panFrom.current = null;
        }}
      >
        <div
          className="lanes-body lanes-scroll"
          ref={scrollerRef}
          onScroll={(e) => {
            if (echo.current) {
              echo.current = false;
              return;
            }
            dispatch({ type: "scrolled", scrollLeft: (e.currentTarget as HTMLElement).scrollLeft });
          }}
        >
          <div
            className="lanes-inner"
            ref={canvasRef}
            style={{ width: NAME_W + scale.width, minHeight: canvasHeight }}
          >
            <Ruler
              segs={scale.segs}
              origin={bounds.t0}
              width={scale.width}
              markers={markers}
              showMarkerLabels={pxPerMs >= MARKER_LABEL_MIN_PX_PER_MS}
              xOf={xOf}
              onScrub={scrub}
            />

            <Lanes
              rows={rows}
              xOf={xOf}
              cull={cull}
              selectedRender={state.selectedRender}
              selectedLane={state.selectedLane}
              {...(lanes ? { lanes } : {})}
              fixApplied={fixApplied}
              onToggleExpand={(key) => dispatch({ type: "toggleLane", key })}
              onSelectLane={(laneKey) => dispatch({ type: "selectLane", laneKey })}
              onSelectClip={(clip) => {
                // Pin before moving the cursor: an explicit pick outranks the
                // playhead-follow until the playhead leaves this clip.
                pinned.current = { renderId: clip.renderId, t0: clip.t0, t1: clip.t1 };
                lastPlayhead.current = clip.t0;
                dispatch({ type: "selectClip", renderId: clip.renderId, laneKey: clip.laneKey });
                onSelectComponent?.(clip.componentId);
                onHighlight?.(clip.componentId);
                onCursor({ t: clip.t0, mode: "historical" });
              }}
              onExpandCluster={(clips) => {
                // Zoom to the cluster's span with a little air either side, so
                // its renders separate instead of landing on the same pixel.
                const t0 = clips[0]!.t0;
                const t1 = clips.at(-1)!.t1;
                const pad = Math.max((t1 - t0) * 0.25, 0.5);
                dispatch({ type: "fitRange", span: { start: t0 - pad, end: t1 + pad } });
              }}
              {...(onHighlight ? { onHighlight } : {})}
            />

            <Arrows edges={arrows} hostRef={canvasRef} />

            <Chrome
              idleSegs={idleSegs}
              region={state.region}
              playhead={model.playhead}
              origin={bounds.t0}
              looping={state.playing}
              canvasWidth={NAME_W + scale.width}
              viewportRight={state.viewport.scrollLeft + state.viewport.width + NAME_W}
              xOf={xOf}
              onRegionEdge={(side, clientX) => {
                if (!state.region) {
                  const t = tOfClient(clientX);
                  dispatch({ type: "setRegion", span: { start: t, end: t } as TimeSpan });
                  return;
                }
                dispatch({ type: "dragRegionEdge", side, t: tOfClient(clientX) });
              }}
            />
          </div>
        </div>
      </div>

      <Footer
        playing={state.playing}
        stats={model.stats}
        pxPerMs={pxPerMs}
        fitPxPerMs={fitPxPerMs}
        isFit={state.viewport.zoom === "fit"}
        {...(transport ? { extra: transport } : {})}
        onPlayToggle={() =>
          dispatch(state.playing ? { type: "pause" } : { type: "play", from: model.playhead })
        }
        onStep={stepPlayhead}
        onZoomTo={(px) => dispatch({ type: "zoomTo", pxPerMs: px })}
        onFit={() => dispatch({ type: "fit" })}
      />
    </div>
  );
}

export { NAME_W };
export type { TimeCursor };
