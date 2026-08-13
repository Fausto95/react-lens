/* oxlint-disable react/react-compiler -- imperative canvas/gesture/derivation caches; not Compiler-safe by design */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentId } from "@reactlens/protocol";
import type { LaneControls } from "../../laneFilter.js";
import type { TimeCursor } from "../../timeCursor.js";
import { buildAxis, clamp, compactGap, easeOut, type TimeAxis } from "../model/axis.js";
import { loupeAt, LOUPE_H, LOUPE_HALF_MS, LOUPE_W, loupeX } from "../model/loupe.js";
import {
  clampView,
  fitWallRange,
  fitWallRangeAround,
  lerpView,
  reanchorAfterAxisChange,
} from "../model/viewport.js";
import {
  advancePlayhead,
  cursorModeAtStop,
  playStartAxis,
  stepCommitTime,
} from "../model/transport.js";
import { timelineKeyAction } from "../keymap.js";
import { clipAtTime, clipCauseColor, type Clip } from "../model/lanes.js";
import type { Timeline as TimelineModel } from "../useTimeline.js";
import { drawBase, drawOverlay, ensureHatchPattern, type ClipRect } from "./draw.js";
import { createTimelineRenderer, type TimelineRendererClient } from "../timelineRendererClient.js";
import { WallStrip } from "./WallStrip.js";
import { Navigator } from "./Navigator.js";
import { Shelf } from "./Shelf.js";
import { Footer } from "./Footer.js";
import { NAME_W, RULER_H, SNAP_PX, VIEW_SPAN_MAX, VIEW_SPAN_MIN, nameWidthFor } from "./metrics.js";
import { causeColor, readTimelineTheme } from "./timelineTheme.js";

const CAUSE_KEYS = ["state", "props", "context", "cascade"] as const;
const CAUSE_VAR: Record<(typeof CAUSE_KEYS)[number], string> = {
  state: "var(--tl-clip-state)",
  props: "var(--tl-clip-props)",
  context: "var(--tl-clip-context)",
  cascade: "var(--tl-clip-cascade)",
};

const HELP: Array<[string, string]> = [
  ["click empty / ruler", "seek playhead (time-travel)"],
  ["drag", "scrub / time-travel (snaps to clip edges)"],
  ["click clip", "inspect without pausing capture"],
  ["click stitch ◆", "expand compressed idle"],
  ["⇧ drag", "set A/B loop region"],
  ["⌥ drag", "marquee zoom"],
  ["middle-drag", "pan with momentum"],
  ["pinch / ⌘ scroll", "zoom at cursor"],
  ["scroll", "pan time · scroll lanes vertically when tall"],
  ["click empty wave", "zoom loupe window"],
  ["double-click clip", "zoom to clip"],
  ["double-click region", "zoom to region"],
  ["double-click empty", "fit"],
  ["space", "play / pause (loops only with A/B)"],
  ["J / K / L", "reverse / stop / forward (tap again = faster)"],
  ["⇧ ← / →", "previous / next commit"],
  ["End / .", "go live (resume capture)"],
  ["[ / ]", "set A / B at playhead"],
  ["Z + click", "zoom to burst"],
  ["F", "zoom to selection"],
  ["0  ·  + / −", "fit · zoom"],
  ["esc", "clear A/B region"],
  ["?", "toggle this panel"],
];

export function Timeline({
  model,
  cursor,
  onCursor,
  lanes: laneControls,
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
  transport?: React.ReactNode;
}) {
  const {
    state,
    dispatch,
    acts,
    gapProgRef,
    layout,
    bounds,
    markers,
    arrows,
    lanes,
    axis,
    commits,
  } = model;

  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  /** OffscreenCanvas base painter; null ⇒ main-thread drawBase fallback. */
  const rendererRef = useRef<TimelineRendererClient | null>(null);
  /** Bump to replace canvas DOM nodes after a failed/reclaimed transfer. */
  const [surfaceGen, setSurfaceGen] = useState(0);
  const preferMainPaint = useRef(false);
  const loupeCvRef = useRef<HTMLCanvasElement>(null);
  const tipElRef = useRef<HTMLDivElement>(null);
  const tipNameRef = useRef<HTMLDivElement>(null);
  const tipCauseRef = useRef<HTMLSpanElement>(null);
  const tipWasteRef = useRef<HTMLSpanElement>(null);
  const tipMetaRef = useRef<HTMLDivElement>(null);
  const loupeElRef = useRef<HTMLDivElement>(null);
  const loupeHeadRef = useRef<HTMLDivElement>(null);
  const phChipRef = useRef<HTMLDivElement>(null);
  const patternRef = useRef<CanvasPattern | null>(null);
  /** Live axis for drawing (tracks gapProg animation frames). */
  const axisLiveRef = useRef<TimeAxis>(axis);
  axisLiveRef.current = buildAxis(acts, gapProgRef.current);

  const playheadRef = useRef(model.playhead);
  // While playing, the transport owns the playhead. A stale live cursor (parent
  // hasn't committed the historical seek yet) must not snap us back to t1.
  if (!(state.playing && cursor.mode === "live")) {
    playheadRef.current = cursor.mode === "live" ? model.playhead : cursor.t;
  }
  const hoverRef = useRef<string | null>(null);
  const ghostRef = useRef<number | null>(null);
  const tipRef = useRef<{ clip: Clip; x: number; y: number } | null>(null);
  const loupeRef = useRef<{
    laneKey: string;
    wallT: number;
    x: number;
    y: number;
  } | null>(null);
  const marqueeRef = useRef<{ x0: number; x1: number } | null>(null);
  const dragRef = useRef<
    | { type: "scrub" }
    /** Pointer down on a clip — becomes scrub only after a drag threshold. */
    | { type: "scrubPending"; x0: number; y0: number }
    /** Empty wave hover target — click zooms the loupe window; drag scrubs. */
    | { type: "waveTap"; x0: number; y0: number; laneKey: string; wallT: number }
    | { type: "pan"; lastX: number; vel: number; lastT: number }
    | { type: "marquee" }
    | { type: "region"; side: "start" | "end" }
    | { type: "regionMove"; grabT: number; start: number; end: number }
    | { type: "pinch" }
    | null
  >(null);
  /** Pixels of movement before a press becomes a historical scrub. */
  const SCRUB_DRAG_PX = 4;
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const clipRectsRef = useRef(new Map<string, ClipRect>());
  const snapEdgesRef = useRef<number[]>([]);
  const zHeld = useRef(false);
  const momentum = useRef(0);
  const viewAnim = useRef(0);
  const gapAnim = useRef(0);
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: state.width, nameW: NAME_W });
  const layoutHRef = useRef(layout.totalH);
  layoutHRef.current = layout.totalH;
  const themeRef = useRef(readTimelineTheme(wrapRef.current?.closest(".rl-redesign") ?? null));

  const nameW = () => sizeRef.current.nameW;

  const aToX = useCallback(
    (a: number) => {
      const v = state.view;
      const nw = nameW();
      return nw + ((a - v.a0) / (v.a1 - v.a0 || 1)) * (sizeRef.current.w - nw);
    },
    [state.view],
  );
  const xToA = useCallback(
    (x: number) => {
      const v = state.view;
      const nw = nameW();
      return v.a0 + ((x - nw) / (sizeRef.current.w - nw || 1)) * (v.a1 - v.a0);
    },
    [state.view],
  );
  const wToX = useCallback((t: number) => aToX(axisLiveRef.current.wallToAxis(t)), [aToX]);
  const xToW = useCallback(
    (x: number) => {
      const ax = axisLiveRef.current;
      return ax.axisToWall(clamp(xToA(x), 0, ax.total));
    },
    [xToA],
  );

  const snap = (t: number, x: number) => {
    let best = t;
    let dist = SNAP_PX + 1;
    for (const e of snapEdgesRef.current) {
      const d = Math.abs(wToX(e) - x);
      if (d < dist) {
        dist = d;
        best = e;
      }
    }
    return best;
  };

  const setPlayhead = (t: number, historical = true) => {
    playheadRef.current = t;
    onCursor(historical ? { mode: "historical", t } : { mode: "live", t: model.bounds.t1 });
  };

  /**
   * Hover chrome (tip / loupe / playhead chip) is driven from refs during paint
   * so scrubbing and hover do not force a React re-render every frame.
   */
  const syncChrome = useCallback(() => {
    const fmtMs = (t: number) => Math.round(t - bounds.t0).toLocaleString("en-US");
    const tipEl = tipElRef.current;
    const tip = tipRef.current;
    if (tipEl) {
      if (!tip) {
        tipEl.style.display = "none";
      } else {
        tipEl.style.display = "block";
        tipEl.style.left = `${tip.x}px`;
        tipEl.style.top = `${tip.y}px`;
        if (tipNameRef.current) {
          tipNameRef.current.textContent = `${tip.clip.name} #${tip.clip.componentId}`;
        }
        if (tipCauseRef.current) {
          const cause = clipCauseColor(tip.clip.cause);
          tipCauseRef.current.textContent = cause;
          tipCauseRef.current.style.color = CAUSE_VAR[cause];
        }
        if (tipWasteRef.current) {
          tipWasteRef.current.style.display = tip.clip.wasted ? "" : "none";
        }
        if (tipMetaRef.current) {
          const self =
            tip.clip.self < tip.clip.total * 0.95 ? ` · ${tip.clip.self.toFixed(1)} ms self` : "";
          tipMetaRef.current.textContent = `${fmtMs(tip.clip.t0)}–${fmtMs(tip.clip.t1)} ms · ${tip.clip.total.toFixed(1)} ms total${self} · row ${(tip.clip.row ?? 0) + 1}`;
        }
      }
    }

    const loupeEl = loupeElRef.current;
    const loupe = loupeRef.current;
    if (loupeEl) {
      if (!loupe) {
        loupeEl.style.display = "none";
        delete loupeEl.dataset.t0;
        delete loupeEl.dataset.t1;
        delete loupeEl.dataset.wallT;
      } else {
        const win = loupeAt(loupe.laneKey, loupe.wallT, LOUPE_HALF_MS, axisLiveRef.current);
        loupeEl.style.display = "block";
        loupeEl.style.left = `${loupe.x}px`;
        loupeEl.style.top = `${Math.max(loupe.y, 2)}px`;
        loupeEl.dataset.t0 = String(win.t0);
        loupeEl.dataset.t1 = String(win.t1);
        loupeEl.dataset.wallT = String(win.wallT);
        if (loupeHeadRef.current) {
          loupeHeadRef.current.textContent = `↳ ${fmtMs(win.t0)}–${fmtMs(win.t1)} ms · click to zoom`;
        }
      }
    }

    const ph = phChipRef.current;
    if (ph) {
      const x = wToX(playheadRef.current);
      const nw = nameW();
      if (x > nw && x < sizeRef.current.w - 74) {
        ph.style.display = "block";
        ph.style.left = `${x + 8}px`;
        const speed = state.playing && state.speed !== 1 ? ` · ${state.speed}×` : "";
        ph.textContent = `t = ${fmtMs(playheadRef.current)} ms${speed}`;
      } else {
        ph.style.display = "none";
      }
    }
  }, [bounds.t0, state.playing, state.speed, wToX]);

  /** Start transport from the cursor, or from the range start if already at the end. */
  const startPlay = (dir: 1 | -1, speed = 1) => {
    const ax = axisLiveRef.current;
    const rg = state.region;
    const a0 = rg ? ax.wallToAxis(rg.start) : 0;
    const a1 = rg ? ax.wallToAxis(rg.end) : ax.total;
    const a = ax.wallToAxis(playheadRef.current);
    const startA = playStartAxis({ a, a0, a1, dir });
    if (Math.abs(startA - a) > 1e-6) setPlayhead(ax.axisToWall(startA));
    dispatch({ type: "play", dir, speed });
  };

  const drawLoupe = useCallback(() => {
    const lp = loupeRef.current;
    const cv = loupeCvRef.current;
    if (!lp || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const lane = lanes.find((l) => l.key === lp.laneKey);
    if (!lane) return;
    const theme = themeRef.current;
    const win = loupeAt(lp.laneKey, lp.wallT, LOUPE_HALF_MS, axisLiveRef.current);
    ctx.clearRect(0, 0, LOUPE_W, LOUPE_H);
    for (const c of lane.clips) {
      if (c.t1 < win.t0 || c.t0 > win.t1) continue;
      const x0 = Math.max(loupeX(c.t0, win), 0);
      const x1 = Math.min(loupeX(c.t1, win), LOUPE_W);
      const y = 5 + ((c.row ?? 0) % 2) * 21;
      const col = causeColor(theme, clipCauseColor(c.cause));
      ctx.fillStyle = c.wasted ? "rgba(150,150,160,.28)" : col + "55";
      ctx.beginPath();
      ctx.roundRect?.(x0, y, Math.max(x1 - x0, 2), 16, 3);
      ctx.fill();
      ctx.strokeStyle = c.wasted ? "rgba(150,150,160,.5)" : col + "88";
      if (c.wasted) ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Crosshair at the hover time (not canvas mid — window may be asymmetric).
    const cx = loupeX(win.wallT, win);
    ctx.strokeStyle = theme.accent + "b3";
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, 0);
    ctx.lineTo(Math.round(cx) + 0.5, LOUPE_H);
    ctx.stroke();
  }, [lanes]);

  const paint = useCallback(
    (base: boolean) => {
      const bc = baseRef.current;
      const oc = overRef.current;
      if (!bc || !oc) return;
      const octx = oc.getContext("2d");
      if (!octx) return;

      const renderer = rendererRef.current;
      // After transferControlToOffscreen, getContext on the base canvas is null.
      const bctx = renderer ? null : bc.getContext("2d");
      if (!renderer && !bctx) return;

      if (bctx && !patternRef.current) patternRef.current = ensureHatchPattern(bctx);

      themeRef.current = readTimelineTheme(wrapRef.current?.closest(".rl-redesign") ?? null);
      const theme = themeRef.current;

      const nw = nameW();
      const proj = {
        aToX,
        wToX,
        nameW: nw,
        stageW: sizeRef.current.w,
        pxPerMs: model.pxPerMs,
      };

      if (base) {
        const axis = axisLiveRef.current;
        if (renderer) {
          renderer.paint(
            {
              axis: {
                segs: axis.segs,
                total: axis.total,
                w0: axis.w0,
                w1: axis.w1,
              },
              view: state.view,
              layout,
              region: state.region,
              markers,
              selectedRender: state.selectedRender,
              nameW: nw,
              stageW: sizeRef.current.w,
              pxPerMs: model.pxPerMs,
              tOrigin: bounds.t0,
              theme,
            },
            (clipRects, snapEdges) => {
              clipRectsRef.current = clipRects;
              snapEdgesRef.current = snapEdges;
            },
          );
        } else if (bctx) {
          const { clipRects, snapEdges } = drawBase({
            ctx: bctx,
            axis,
            view: state.view,
            layout,
            region: state.region,
            markers,
            selectedRender: state.selectedRender,
            proj,
            pattern: patternRef.current,
            tOrigin: bounds.t0,
            theme,
          });
          clipRectsRef.current = clipRects;
          snapEdgesRef.current = snapEdges;
        }
      }

      drawOverlay({
        ctx: octx,
        stageW: sizeRef.current.w,
        totalH: layout.totalH,
        nameW: nw,
        clipRects: clipRectsRef.current,
        edges: arrows,
        selectedRender: state.selectedRender,
        marquee: marqueeRef.current,
        hoverId: hoverRef.current,
        ghostT: ghostRef.current,
        playheadT: playheadRef.current,
        wToX,
        dragging: dragRef.current != null,
        theme,
      });
      drawLoupe();
      syncChrome();
    },
    [
      aToX,
      wToX,
      state.view,
      state.region,
      state.selectedRender,
      layout,
      markers,
      bounds.t0,
      arrows,
      model.pxPerMs,
      drawLoupe,
      syncChrome,
    ],
  );

  const scheduleDraw = useCallback(
    (base: boolean) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => paint(base));
    },
    [paint],
  );
  // Transport must not restart when paint/scheduleDraw identity churns — that
  // froze replay by resetting `last` every cursor tick (see useLatest.ts).
  const scheduleDrawRef = useRef(scheduleDraw);
  scheduleDrawRef.current = scheduleDraw;
  const setPlayheadRef = useRef(setPlayhead);
  setPlayheadRef.current = setPlayhead;
  const playOptsRef = useRef({
    speed: state.speed,
    dir: state.playDir,
    region: state.region,
  });
  playOptsRef.current = {
    speed: state.speed,
    dir: state.playDir,
    region: state.region,
  };

  const stepCommit = (dir: -1 | 1) => {
    if (state.playing) dispatch({ type: "pause" });
    const next = stepCommitTime(commits, playheadRef.current, dir);
    if (next == null) return;
    setPlayhead(next);
    scheduleDraw(false);
  };

  // OffscreenCanvas transfer is one-shot per canvas element. The client caches
  // by canvas identity so StrictMode remounts reuse the live worker instead of
  // transferring twice. Never dispose on effect cleanup for that reason.
  useEffect(() => {
    if (preferMainPaint.current) return;
    const base = baseRef.current;
    if (!base) return;
    const client = createTimelineRenderer(base);
    if (!client) {
      preferMainPaint.current = true;
      setSurfaceGen((g) => g + 1);
      return;
    }
    rendererRef.current = client;
  }, [surfaceGen]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const resize = () => {
      const w = el.clientWidth;
      sizeRef.current.w = w;
      sizeRef.current.nameW = nameWidthFor(w);
      dispatch({ type: "measure", width: w });
      const h = layout.totalH;
      const dpr = window.devicePixelRatio || 1;
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.resize(w, h, dpr);
        const baseCv = baseRef.current;
        if (baseCv) {
          baseCv.style.width = `${w}px`;
          baseCv.style.height = `${h}px`;
        }
      }
      for (const cv of renderer ? [overRef.current] : [baseRef.current, overRef.current]) {
        if (!cv) continue;
        // Offscreen-transferred canvases throw on width/height writes; skip them
        // (the worker owns their buffer). A remount can race resize before the
        // renderer client is reattached to rendererRef.
        if (cv === baseRef.current && renderer == null && cv.getContext("2d") == null) {
          continue;
        }
        try {
          cv.width = w * dpr;
          cv.height = h * dpr;
        } catch {
          continue;
        }
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
        cv.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const lc = loupeCvRef.current;
      if (lc) {
        lc.width = LOUPE_W * dpr;
        lc.height = LOUPE_H * dpr;
        lc.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      paint(true);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dispatch, layout.totalH, paint]);

  useEffect(() => {
    scheduleDraw(true);
  }, [state.selectedRender, state.shelfOpen, state.region, layout, scheduleDraw]);

  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => scheduleDraw(true));
    obs.observe(root, { attributes: true, attributeFilter: ["data-rl-theme"] });
    return () => obs.disconnect();
  }, [scheduleDraw]);

  const setView = (a0: number, span: number, redraw = true) => {
    dispatch({ type: "setView", a0, span });
    if (redraw) scheduleDraw(true);
  };

  const animateView = (a0: number, span: number, dur = 150) => {
    cancelAnimationFrame(viewAnim.current);
    const from = { ...state.view };
    const to = clampView(a0, span, axisLiveRef.current.total);
    const start = performance.now();
    const step = (now: number) => {
      const t = easeOut(clamp((now - start) / dur, 0, 1));
      const v = lerpView(from, to, t);
      dispatch({ type: "setView", a0: v.a0, span: v.a1 - v.a0 });
      scheduleDraw(true);
      if (t < 1) viewAnim.current = requestAnimationFrame(step);
    };
    viewAnim.current = requestAnimationFrame(step);
  };

  const zoomAt = (factor: number, anchorX: number, animated = false) => {
    const ax = axisLiveRef.current;
    const anchor = xToA(Math.max(anchorX, nameW()));
    const span = state.view.a1 - state.view.a0;
    const ns = clamp(span * factor, VIEW_SPAN_MIN, Math.max(ax.total, VIEW_SPAN_MAX));
    const na0 = anchor - ((anchor - state.view.a0) / span) * ns;
    if (animated) animateView(na0, ns);
    else setView(na0, ns);
  };

  const fit = () => animateView(0, axisLiveRef.current.total, 200);
  const doFitWall = (w0: number, w1: number, animated = true) => {
    const v = fitWallRange(axisLiveRef.current, w0, w1);
    if (animated) animateView(v.a0, v.a1 - v.a0, 180);
    else setView(v.a0, v.a1 - v.a0);
  };

  const doFitLoupe = (w0: number, w1: number, centerW: number) => {
    const v = fitWallRangeAround(axisLiveRef.current, w0, w1, centerW);
    animateView(v.a0, v.a1 - v.a0, 180);
  };

  /** Zoom the timeline to a loupe wall window, keeping `centerW` centered. */
  const applyLoupeZoom = (laneKey: string, wallT: number) => {
    const win = loupeAt(laneKey, wallT, LOUPE_HALF_MS, axisLiveRef.current);
    doFitLoupe(win.t0, win.t1, win.wallT);
    loupeRef.current = null;
    tipRef.current = null;
    syncChrome();
    scheduleDraw(true);
  };

  const toggleGap = (id: string) => {
    const target = state.expandedGaps.has(id) ? 0 : 1;
    dispatch({ type: "toggleGap", id });
    cancelAnimationFrame(gapAnim.current);
    const from = gapProgRef.current.get(id) ?? 0;
    const start = performance.now();
    const dur = 240;
    const step = (now: number) => {
      const t = easeOut(clamp((now - start) / dur, 0, 1));
      const prev = axisLiveRef.current;
      const centerW = prev.axisToWall((state.view.a0 + state.view.a1) / 2);
      const prevTotal = prev.total;
      gapProgRef.current.set(id, from + (target - from) * t);
      const next = buildAxis(acts, gapProgRef.current);
      axisLiveRef.current = next;
      const re = reanchorAfterAxisChange(state.view, prevTotal, next, centerW);
      dispatch({ type: "setView", a0: re.a0, span: re.a1 - re.a0 });
      scheduleDraw(true);
      if (t < 1) gapAnim.current = requestAnimationFrame(step);
    };
    gapAnim.current = requestAnimationFrame(step);
  };

  /** Expand every fully-compressed idle gap toward wall time. */
  const expandAllIdle = () => {
    const ids = axisLiveRef.current.segs
      .filter((s): s is Extract<typeof s, { type: "gap" }> => s.type === "gap")
      .filter((s) => s.a1 - s.a0 < 1e-6 && !state.expandedGaps.has(s.id))
      .map((s) => s.id);
    if (ids.length === 0) return;
    for (const id of ids) dispatch({ type: "toggleGap", id });
    cancelAnimationFrame(gapAnim.current);
    const from = new Map(ids.map((id) => [id, gapProgRef.current.get(id) ?? 0]));
    const start = performance.now();
    const dur = 280;
    const step = (now: number) => {
      const t = easeOut(clamp((now - start) / dur, 0, 1));
      const prev = axisLiveRef.current;
      const centerW = prev.axisToWall((state.view.a0 + state.view.a1) / 2);
      const prevTotal = prev.total;
      for (const id of ids) {
        gapProgRef.current.set(id, (from.get(id) ?? 0) + (1 - (from.get(id) ?? 0)) * t);
      }
      const next = buildAxis(acts, gapProgRef.current);
      axisLiveRef.current = next;
      const re = reanchorAfterAxisChange(state.view, prevTotal, next, centerW);
      dispatch({ type: "setView", a0: re.a0, span: re.a1 - re.a0 });
      scheduleDraw(true);
      if (t < 1) gapAnim.current = requestAnimationFrame(step);
    };
    gapAnim.current = requestAnimationFrame(step);
  };

  const goLive = () => {
    playheadRef.current = bounds.t1;
    onCursor({ mode: "live", t: bounds.t1 });
    scheduleDraw(false);
  };

  const hitClip = (x: number, y: number): ClipRect | null => {
    for (const r of clipRectsRef.current.values()) {
      if (x >= r.x0 - 2 && x <= r.x1 + 2 && y >= r.y0 && y <= r.y1) return r;
    }
    return null;
  };

  /**
   * Inspect a clip without pausing capture while live. A historical cursor
   * keeps time travel applied (instrumentation drops commits); clip taps must
   * not enter that mode. While already scrubbing the past, seek to the clip.
   */
  const inspectClip = (clip: Clip) => {
    dispatch({
      type: "selectClip",
      renderId: clip.renderId,
      laneKey: clip.laneKey,
    });
    if (cursor.mode === "historical") {
      setPlayhead((clip.t0 + clip.t1) / 2);
    }
    onSelectComponent?.(clip.componentId);
    onHighlight?.(clip.componentId);
    scheduleDraw(true);
  };

  /**
   * Stack hit, or a tight soft-hit on a wave/lane clip.
   * Soft-hit is for inspection only (wave rows have no stack targets) and must
   * stay local — a generous radius would steal empty-track seeks from the
   * playhead / ruler.
   */
  const clipUnderPointer = (x: number, y: number): Clip | null => {
    const hard = hitClip(x, y);
    if (hard) return hard.clip;
    if (x <= nameW() || y < RULER_H) return null;
    const row = layout.rows.find((r) => y >= r.y && y <= r.y + r.h);
    if (!row) return null;
    const t = xToW(x);
    const clip = clipAtTime([row.lane], t, row.key);
    if (!clip) return null;
    if (t >= clip.t0 && t <= clip.t1) return clip;
    const SOFT_PX = 10;
    if (Math.abs(wToX(clip.t0) - x) <= SOFT_PX || Math.abs(wToX(clip.t1) - x) <= SOFT_PX) {
      return clip;
    }
    if (Math.abs(wToX((clip.t0 + clip.t1) / 2) - x) <= SOFT_PX) return clip;
    return null;
  };

  const localXY = (e: { clientX: number; clientY: number }) => {
    const el = wrapRef.current!;
    const r = el.getBoundingClientRect();
    const viewY = e.clientY - r.top;
    return {
      x: e.clientX - r.left,
      y: viewY + el.scrollTop,
      viewY,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelAnimationFrame(momentum.current);
    if (pointersRef.current.size === 2) {
      dragRef.current = { type: "pinch" };
      return;
    }
    const { x, y } = localXY(e);
    if (x < nameW()) return;

    if (e.button === 1) {
      dragRef.current = { type: "pan", lastX: e.clientX, vel: 0, lastT: performance.now() };
      e.preventDefault();
    } else if (zHeld.current) {
      const t = xToW(x);
      const ax = axisLiveRef.current;
      const seg = ax.segs.find((s) => s.type === "act" && t >= s.w0 && t <= s.w1);
      if (seg && seg.type === "act") doFitWall(seg.w0, seg.w1);
      return;
    } else if (e.altKey) {
      dragRef.current = { type: "marquee" };
      marqueeRef.current = { x0: x, x1: x };
    } else if (e.shiftKey) {
      const w = xToW(x);
      dispatch({ type: "setRegion", span: { start: w, end: w } });
      dragRef.current = { type: "region", side: "end" };
    } else {
      const rg = state.region;
      if (rg) {
        for (const side of ["start", "end"] as const) {
          if (Math.abs(wToX(rg[side]) - x) < 6) {
            dragRef.current = { type: "region", side };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
        }
        if (y < RULER_H && x > wToX(rg.start) && x < wToX(rg.end)) {
          dragRef.current = {
            type: "regionMove",
            grabT: xToW(x),
            start: rg.start,
            end: rg.end,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = clipUnderPointer(x, y);
      if (hit) {
        inspectClip(hit);
        // Tap = inspect (stays live). Drag past the threshold still scrubs.
        dragRef.current = { type: "scrubPending", x0: x, y0: y };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      // Empty wave: tap zooms the loupe window; drag still scrubs.
      const waveRow = layout.rows.find((r) => y >= r.y && y <= r.y + r.h && r.mode === "wave");
      if (waveRow && x > nameW()) {
        dragRef.current = {
          type: "waveTap",
          x0: x,
          y0: y,
          laneKey: waveRow.key,
          wallT: xToW(x),
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      // Empty track / ruler: place the playhead under the cursor. Clip taps
      // above stay inspect-only so capture is not paused by accident.
      setPlayhead(snap(xToW(x), x));
      dragRef.current = { type: "scrub" };
      scheduleDraw(false);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointersRef.current;
    if (p.has(e.pointerId)) {
      const prev = [...p.entries()];
      p.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dragRef.current?.type === "pinch" && p.size === 2) {
        const a0 = prev[0]?.[1];
        const b0 = prev[1]?.[1];
        const entries = [...p.entries()];
        const a1 = entries[0]?.[1];
        const b1 = entries[1]?.[1];
        if (!a0 || !b0 || !a1 || !b1) return;
        const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1;
        const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y) || 1;
        const rect = wrapRef.current!.getBoundingClientRect();
        const mid0 = (a0.x + b0.x) / 2;
        const mid1 = (a1.x + b1.x) / 2;
        zoomAt(d0 / d1, mid1 - rect.left);
        const span = state.view.a1 - state.view.a0;
        setView(state.view.a0 - ((mid1 - mid0) * span) / (sizeRef.current.w - nameW()), span);
        return;
      }
    }

    const { x, y, viewY } = localXY(e);
    const d = dragRef.current;
    if (!d) {
      const soft = clipUnderPointer(x, y);
      const id = soft ? String(soft.renderId) : null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        onHighlight?.(soft?.componentId ?? null);
      }
      const scrollTop = wrapRef.current?.scrollTop ?? 0;
      tipRef.current = soft
        ? {
            clip: soft,
            x: clamp(x + 14, nameW(), sizeRef.current.w - 190),
            y: viewY + 16,
          }
        : null;
      ghostRef.current = x > nameW() ? xToW(x) : null;
      // Loupe is a wave-only empty-track preview — never over clips, stack
      // rows, the ruler, or while a tip is showing.
      const row = layout.rows.find((r) => y >= r.y && y <= r.y + r.h && r.mode === "wave");
      if (row && x > nameW() && !soft) {
        loupeRef.current = {
          laneKey: row.key,
          wallT: xToW(x),
          x: clamp(x - 145, nameW() + 4, sizeRef.current.w - 296),
          y: row.y - scrollTop - 52,
        };
      } else loupeRef.current = null;
      scheduleDraw(false);
      return;
    }
    if (d.type === "pan") {
      const now = performance.now();
      const dx = e.clientX - d.lastX;
      const span = state.view.a1 - state.view.a0;
      const aPerPx = span / (sizeRef.current.w - nameW());
      setView(state.view.a0 - dx * aPerPx, span);
      d.vel = 0.8 * d.vel + 0.2 * (dx / Math.max(now - d.lastT, 1));
      d.lastX = e.clientX;
      d.lastT = now;
    }
    if (d.type === "scrubPending") {
      if (Math.hypot(x - d.x0, y - d.y0) >= SCRUB_DRAG_PX) {
        dragRef.current = { type: "scrub" };
        setPlayhead(snap(xToW(x), x));
        scheduleDraw(false);
      }
      return;
    }
    if (d.type === "waveTap") {
      if (Math.hypot(x - d.x0, y - d.y0) >= SCRUB_DRAG_PX) {
        dragRef.current = { type: "scrub" };
        setPlayhead(snap(xToW(x), x));
        loupeRef.current = null;
        scheduleDraw(false);
      }
      return;
    }
    if (d.type === "scrub") {
      setPlayhead(snap(xToW(x), x));
      scheduleDraw(false);
    }
    if (d.type === "marquee" && marqueeRef.current) {
      marqueeRef.current.x1 = x;
      scheduleDraw(false);
    }
    if (d.type === "region") {
      dispatch({ type: "dragRegionEdge", side: d.side, t: xToW(x) });
      scheduleDraw(true);
    }
    if (d.type === "regionMove") {
      const dt = xToW(x) - d.grabT;
      dispatch({
        type: "setRegion",
        span: { start: d.start + dt, end: d.end + dt },
      });
      scheduleDraw(true);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    const d = dragRef.current;
    if (d?.type === "scrubPending") {
      // Clip tap released without dragging — inspection already applied on down.
      dragRef.current = null;
      return;
    }
    if (d?.type === "waveTap") {
      // Empty-wave click — zoom to the loupe window under the press.
      applyLoupeZoom(d.laneKey, d.wallT);
      dragRef.current = null;
      return;
    }
    if (d?.type === "marquee" && marqueeRef.current) {
      const { x0, x1 } = marqueeRef.current;
      if (Math.abs(x1 - x0) > 8) {
        doFitWall(xToW(Math.min(x0, x1)), xToW(Math.max(x0, x1)));
      }
      marqueeRef.current = null;
      scheduleDraw(true);
    }
    if (d?.type === "pan" && Math.abs(d.vel) > 0.05) {
      let vel = d.vel;
      let last = performance.now();
      const decay = (now: number) => {
        const dt = now - last;
        last = now;
        const span = state.view.a1 - state.view.a0;
        setView(state.view.a0 - (vel * dt * span) / (sizeRef.current.w - nameW()), span);
        vel *= Math.pow(0.94, dt / 16);
        if (Math.abs(vel) > 0.01) momentum.current = requestAnimationFrame(decay);
      };
      momentum.current = requestAnimationFrame(decay);
    }
    dragRef.current = pointersRef.current.size ? dragRef.current : null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x } = localXY(e);
    const hit = hitClip(x, localXY(e).y);
    if (hit) {
      const c = hit.clip;
      const pad = (c.t1 - c.t0) * 2;
      doFitWall(c.t0 - pad, c.t1 + pad);
      return;
    }
    const rg = state.region;
    if (rg && x > wToX(rg.start) && x < wToX(rg.end)) {
      doFitWall(rg.start, rg.end);
      return;
    }
    fit();
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(e.deltaY * 0.004), x);
        return;
      }
      const overflowY = layoutHRef.current > el.clientHeight + 1;
      if (overflowY && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollTop = Math.max(
          0,
          Math.min(el.scrollTop + e.deltaY, layoutHRef.current - el.clientHeight),
        );
        return;
      }
      const span = state.view.a1 - state.view.a0;
      setView(state.view.a0 + ((e.deltaY + e.deltaX) * span) / 900, span);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // Transport: axis-uniform JKL / space. Loops only when an A/B region is set.
  useEffect(() => {
    if (!state.playing) return;
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last != null) {
        const ax = axisLiveRef.current;
        const { speed, dir, region: rg } = playOptsRef.current;
        const loop = rg != null;
        const aw0 = rg ? ax.wallToAxis(rg.start) : 0;
        const aw1 = rg ? ax.wallToAxis(rg.end) : ax.total;
        const pa = ax.wallToAxis(playheadRef.current);
        const deltaA = Math.min(ts - last, 100) * ((aw1 - aw0) / 2300) * speed * dir;
        const next = advancePlayhead({ a: pa, deltaA, a0: aw0, a1: aw1, loop });
        const live = next.kind === "stop" && cursorModeAtStop({ dir, loop }) === "live";
        // Catching up with the present must release time travel, or the page
        // keeps dropping commits and nothing is traced after the replay.
        setPlayheadRef.current(ax.axisToWall(next.a), !live);
        scheduleDrawRef.current(false);
        if (next.kind === "stop") {
          dispatch({ type: "pause" });
          return;
        }
      }
      last = ts;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, dispatch]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key.toLowerCase() === "z") zHeld.current = true;
      const action = timelineKeyAction(e);
      if (!action) return;
      if (
        action.kind === "toggle-play" ||
        action.kind === "play-forward" ||
        action.kind === "play-reverse"
      ) {
        e.preventDefault();
      }
      switch (action.kind) {
        case "toggle-play":
          if (state.playing) dispatch({ type: "pause" });
          else startPlay(1, 1);
          break;
        case "play-forward":
          if (state.playing && state.playDir === 1)
            dispatch({ type: "setSpeed", speed: Math.min(state.speed * 2, 4) });
          else startPlay(1, 1);
          break;
        case "play-reverse":
          if (state.playing && state.playDir === -1)
            dispatch({ type: "setSpeed", speed: Math.min(state.speed * 2, 4) });
          else startPlay(-1, 1);
          break;
        case "stop":
          dispatch({ type: "pause" });
          dispatch({ type: "setSpeed", speed: 1 });
          break;
        case "set-in":
          dispatch({
            type: "setRegion",
            span: {
              start: playheadRef.current,
              end: Math.max(
                state.region?.end ?? playheadRef.current + 100,
                playheadRef.current + 10,
              ),
            },
          });
          scheduleDraw(true);
          break;
        case "set-out":
          dispatch({
            type: "setRegion",
            span: {
              start: Math.min(
                state.region?.start ?? playheadRef.current - 100,
                playheadRef.current - 10,
              ),
              end: playheadRef.current,
            },
          });
          scheduleDraw(true);
          break;
        case "escape-band":
          dispatch({ type: "setRegion", span: null });
          dispatch({ type: "setHelp", open: false });
          scheduleDraw(true);
          break;
        case "fit-selection": {
          const c = lanes.flatMap((l) => l.clips).find((x) => x.renderId === state.selectedRender);
          if (c) {
            const pad = (c.t1 - c.t0) * 2;
            doFitWall(c.t0 - pad, c.t1 + pad);
          }
          break;
        }
        case "fit":
          fit();
          break;
        case "zoom":
          zoomAt(action.factor, sizeRef.current.w / 2, true);
          break;
        case "toggle-help":
          dispatch({ type: "toggleHelp" });
          break;
        case "nudge-playhead": {
          const v = state.view;
          const ax = axisLiveRef.current;
          const dA = (v.a1 - v.a0) * 0.02 * action.dir;
          setPlayhead(ax.axisToWall(clamp(ax.wallToAxis(playheadRef.current) + dA, 0, ax.total)));
          scheduleDraw(false);
          break;
        }
        case "step-commit":
          stepCommit(action.dir);
          break;
        case "go-live":
          goLive();
          break;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "z") zHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  // Follow selection under playhead for inspector
  useEffect(() => {
    if (state.playing) return;
    const clip = clipAtTime(lanes, playheadRef.current, state.selectedLane);
    if (clip && clip.renderId !== state.selectedRender) {
      // don't auto-steal selection while scrubbing casually — only when playing
    }
  }, [state.playing, lanes, state.selectedLane, state.selectedRender]);

  const navBlips = useMemo(() => {
    const all = lanes.flatMap((l) => l.clips);
    return all.filter((_, i) => i % 6 === 0);
  }, [lanes]);

  const gapChips = axisLiveRef.current.segs
    .filter((s): s is Extract<typeof s, { type: "gap" }> => s.type === "gap")
    // Only expanded gaps are visible; collapsed idle is fully compressed away.
    .filter((s) => s.a1 - s.a0 > 1e-6)
    .map((s) => ({ ...s, x0: aToX(s.a0), x1: aToX(s.a1) }))
    .filter((s) => s.x1 > nameW() + 3 && s.x0 < sizeRef.current.w);

  const stitches = axisLiveRef.current.segs
    .filter((s): s is Extract<typeof s, { type: "gap" }> => s.type === "gap")
    .filter((s) => s.a1 - s.a0 < 1e-6)
    .map((s) => ({ id: s.id, x: aToX(s.a0), ms: s.w1 - s.w0 }))
    .filter((s) => s.x > nameW() + 2 && s.x < sizeRef.current.w - 2);

  const liveAxis = axisLiveRef.current;
  const rg = state.region;
  const inScope = lanes
    .flatMap((l) => l.clips)
    .filter((c) => {
      if (rg && (c.t1 < rg.start || c.t0 > rg.end)) return false;
      return true;
    });
  const wastedN = inScope.filter((c) => c.wasted).length;
  const idleTotal = liveAxis.segs
    .filter((s) => s.type === "gap" && s.p < 0.5)
    .reduce((a, s) => a + (s.w1 - s.w0), 0);
  const sel =
    state.selectedRender != null
      ? (lanes.flatMap((l) => l.clips).find((c) => c.renderId === state.selectedRender) ?? null)
      : null;
  const narrow = sizeRef.current.w < 720;

  return (
    <div className="tl tl-canvas-root">
      <div className="tl-toolbar">
        <div className="tl-toolbar-brand">
          <span className="tl-toolbar-lens" />
          Timeline
        </div>
        <button
          type="button"
          className={`tl-btn${state.playing && state.playDir === -1 ? " on" : ""}`}
          onClick={() => startPlay(-1, 1)}
          aria-label="Play in reverse"
          aria-pressed={state.playing && state.playDir === -1}
          title="Play in reverse (J)"
        >
          ◂◂
        </button>
        <button
          type="button"
          className={`tl-btn${state.playing ? " on" : ""}`}
          onClick={() => (state.playing ? dispatch({ type: "pause" }) : startPlay(1, 1))}
          aria-label="Play"
          aria-pressed={state.playing}
          title={state.playing ? "Pause (Space)" : "Play (Space)"}
        >
          {state.playing ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          className="tl-btn"
          onClick={() => stepCommit(-1)}
          aria-label="Previous commit"
          title="Previous commit (⇧←)"
          disabled={commits.length === 0}
        >
          ‹
        </button>
        <button
          type="button"
          className="tl-btn"
          onClick={() => stepCommit(1)}
          aria-label="Next commit"
          title="Next commit (⇧→)"
          disabled={commits.length === 0}
        >
          ›
        </button>
        <button
          type="button"
          className="tl-btn"
          onClick={() =>
            dispatch({
              type: "setSpeed",
              speed: state.speed >= 4 ? 0.5 : state.speed * 2,
            })
          }
        >
          {state.speed}×
        </button>
        {transport && (
          <>
            <span className="tl-toolbar-sep" />
            <span className="tl-toolbar-transport">{transport}</span>
          </>
        )}
        <span className="tl-toolbar-sep" />
        <button
          type="button"
          className="tl-btn"
          onClick={() => zoomAt(0.72, sizeRef.current.w / 2, true)}
        >
          +
        </button>
        <button
          type="button"
          className="tl-btn"
          onClick={() => zoomAt(1.4, sizeRef.current.w / 2, true)}
        >
          −
        </button>
        <button type="button" className="tl-btn" onClick={fit}>
          Fit
        </button>
        {cursor.mode === "historical" && (
          <button
            type="button"
            className="tl-btn on"
            onClick={goLive}
            title="Go live — resume capture (End)"
          >
            Live
          </button>
        )}
        <button type="button" className="tl-btn" onClick={() => dispatch({ type: "toggleHelp" })}>
          ?
        </button>
        <div className="tl-toolbar-legend">
          {CAUSE_KEYS.map((k) => (
            <span key={k}>
              <i style={{ background: CAUSE_VAR[k] }} />
              {k}
            </span>
          ))}
        </div>
      </div>

      <WallStrip nameW={sizeRef.current.nameW} axis={liveAxis} view={state.view} blips={navBlips} />

      <div
        ref={wrapRef}
        className="tl-stage"
        style={{ touchAction: "none", position: "relative" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => {
          ghostRef.current = null;
          tipRef.current = null;
          loupeRef.current = null;
          hoverRef.current = null;
          scheduleDraw(false);
        }}
      >
        <canvas key={`base-${surfaceGen}`} ref={baseRef} style={{ display: "block" }} />
        <canvas
          key={`over-${surfaceGen}`}
          ref={overRef}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        />

        {layout.rows.map((r) => (
          <div
            key={r.key}
            className="tl-lname"
            data-lane={r.key}
            style={{
              position: "absolute",
              left: 0,
              top: r.y,
              width: sizeRef.current.nameW - 1,
              height: r.h,
              color: r.dim ? "var(--text-3)" : "var(--text-2)",
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="tl-lname-text">{r.lane.name}</span>
            {r.lane.instanceCount > 1 && (
              <span className="tl-lname-count">×{r.lane.instanceCount}</span>
            )}
            {r.mode === "stack" && r.depth > 1 && (
              <span className="tl-lname-stack">▤×{r.depth}</span>
            )}
            {laneControls && (
              <span className="tl-lname-acts">
                <span
                  className={`tl-ra${laneControls.filter.solo.has(r.key) ? " on" : ""}`}
                  title="Solo"
                  onClick={() => laneControls.toggleSolo(r.key)}
                >
                  S
                </span>
                <span
                  className={`tl-ra${laneControls.filter.muted.has(r.key) ? " on" : ""}`}
                  title="Mute"
                  onClick={() => laneControls.toggleMute(r.key)}
                >
                  M
                </span>
              </span>
            )}
          </div>
        ))}

        {stitches.map((s) => (
          <button
            key={s.id}
            type="button"
            className="tl-stitch"
            style={{ left: s.x - 6 }}
            title={`Expand idle +${compactGap(s.ms)}`}
            aria-label={`Expand idle +${compactGap(s.ms)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => toggleGap(s.id)}
          />
        ))}

        {gapChips.map((s) => {
          // Clip to the visible stage so a zoomed-wide idle region doesn't
          // push the chip (and "collapse") past the gutter / off-screen.
          const stageL = nameW() + 2;
          const stageR = sizeRef.current.w - 2;
          const left = Math.max(s.x0 + 2, stageL);
          const right = Math.min(s.x1 - 2, stageR);
          const width = right - left;
          if (width < 28) return null;
          return (
            <div
              key={s.id}
              className="tl-gap"
              style={{
                left,
                top: RULER_H + 4,
                width,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => toggleGap(s.id)}
            >
              ◂ collapse
            </div>
          );
        })}

        <div
          ref={phChipRef}
          className="tl-ph-chip"
          style={{ top: RULER_H + 4, pointerEvents: "none", display: "none" }}
        />

        <div ref={tipElRef} className="tl-tip" style={{ display: "none" }}>
          <div ref={tipNameRef} className="tl-tip-name" />
          <div>
            <span ref={tipCauseRef} />
            <span ref={tipWasteRef} style={{ color: "var(--warn)", display: "none" }}>
              {" "}
              · wasted
            </span>
          </div>
          <div ref={tipMetaRef} className="tl-tip-meta" />
        </div>

        <div
          ref={loupeElRef}
          className="tl-loupe"
          style={{ display: "none", width: 292, pointerEvents: "none" }}
        >
          <div ref={loupeHeadRef} className="tl-loupe-head" />
          <canvas ref={loupeCvRef} style={{ display: "block", width: LOUPE_W, height: LOUPE_H }} />
        </div>

        {state.showHelp && (
          <div className="tl-help" onPointerDown={(e) => e.stopPropagation()}>
            <div className="tl-help-title">SHORTCUTS</div>
            {HELP.map(([k, d]) => (
              <div key={k} className="tl-help-row">
                <span style={{ color: "var(--accent)", fontFamily: "var(--mono)" }}>{k}</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Shelf
        quietLanes={layout.quietLanes}
        open={state.shelfOpen}
        narrow={narrow}
        onToggle={() => dispatch({ type: "toggleShelf" })}
      />

      <Navigator
        nameW={sizeRef.current.nameW}
        axis={liveAxis}
        view={state.view}
        blips={navBlips}
        onView={(a0, span, animate) => (animate ? animateView(a0, span) : setView(a0, span))}
      />

      <Footer
        selection={sel}
        inScope={inScope.length}
        wastedN={wastedN}
        idleCollapsedMs={idleTotal}
        regionActive={rg != null}
        onExpandIdle={idleTotal > 0 ? expandAllIdle : undefined}
      />
    </div>
  );
}
