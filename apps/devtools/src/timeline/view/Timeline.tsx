import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { ComponentId } from "@reactlens/protocol";
import type { LaneControls } from "../../laneFilter.js";
import type { TimeCursor } from "../../timeCursor.js";
import { buildAxis, clamp, easeOut, type TimeAxis } from "../model/axis.js";
import { loupeAt, LOUPE_H, LOUPE_HALF_MS, LOUPE_W, loupeX } from "../model/loupe.js";
import { clampView, fitWallRange, lerpView, reanchorAfterAxisChange } from "../model/viewport.js";
import { advancePlayhead, cursorModeAtStop, playStartAxis } from "../model/transport.js";
import { timelineKeyAction } from "../keymap.js";
import { clipAtTime, clipCauseColor, type Clip } from "../model/lanes.js";
import type { Timeline as TimelineModel } from "../useTimeline.js";
import { drawBase, drawOverlay, ensureHatchPattern, type ClipRect } from "./draw.js";
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
  ["⇧ drag", "set A/B loop region"],
  ["⌥ drag", "marquee zoom"],
  ["middle-drag", "pan with momentum"],
  ["pinch / ⌘ scroll", "zoom at cursor"],
  ["scroll", "pan time · scroll lanes vertically when tall"],
  ["double-click clip", "zoom to clip"],
  ["double-click region", "zoom to region"],
  ["double-click empty", "fit"],
  ["space", "play / pause (loops only with A/B)"],
  ["J / K / L", "reverse / stop / forward (tap again = faster)"],
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
  const { state, dispatch, acts, gapProgRef, layout, bounds, markers, arrows, lanes, axis } = model;
  const [, force] = useReducer((x: number) => x + 1, 0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const loupeCvRef = useRef<HTMLCanvasElement>(null);
  const patternRef = useRef<CanvasPattern | null>(null);
  /** Live axis for drawing (tracks gapProg animation frames). */
  const axisLiveRef = useRef<TimeAxis>(axis);
  axisLiveRef.current = buildAxis(acts, gapProgRef.current);

  const playheadRef = useRef(model.playhead);
  playheadRef.current = cursor.mode === "live" ? model.playhead : cursor.t;
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
    /** Pointer down on empty track — becomes scrub only after a drag threshold. */
    | { type: "scrubPending"; x0: number; y0: number }
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
    const win = loupeAt(lp.laneKey, lp.wallT);
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
    ctx.strokeStyle = theme.accent + "b3";
    ctx.beginPath();
    ctx.moveTo(LOUPE_W / 2 + 0.5, 0);
    ctx.lineTo(LOUPE_W / 2 + 0.5, LOUPE_H);
    ctx.stroke();
  }, [lanes]);

  const paint = useCallback(
    (base: boolean) => {
      const bc = baseRef.current;
      const oc = overRef.current;
      if (!bc || !oc) return;
      const bctx = bc.getContext("2d");
      const octx = oc.getContext("2d");
      if (!bctx || !octx) return;

      if (!patternRef.current) patternRef.current = ensureHatchPattern(bctx);

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
        const { clipRects, snapEdges } = drawBase({
          ctx: bctx,
          axis: axisLiveRef.current,
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
      force();
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
      acts,
      state.expandedGaps,
    ],
  );

  const scheduleDraw = useCallback(
    (base: boolean) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => paint(base));
    },
    [paint],
  );

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
      for (const cv of [baseRef.current, overRef.current]) {
        if (!cv) continue;
        cv.width = w * dpr;
        cv.height = h * dpr;
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
      const hit = hitClip(x, y);
      const id = hit ? String(hit.clip.renderId) : null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        onHighlight?.(hit?.clip.componentId ?? null);
      }
      const scrollTop = wrapRef.current?.scrollTop ?? 0;
      tipRef.current = hit
        ? {
            clip: hit.clip,
            x: clamp(x + 14, nameW(), sizeRef.current.w - 190),
            y: viewY + 16,
          }
        : null;
      ghostRef.current = x > nameW() ? xToW(x) : null;
      const row = layout.rows.find((r) => y >= r.y && y <= r.y + r.h && r.mode === "wave");
      if (row && x > nameW() && !hit) {
        loupeRef.current = {
          laneKey: row.key,
          wallT: xToW(x),
          x: clamp(x - 145, nameW() + 4, sizeRef.current.w - 296),
          y: row.y - scrollTop - 76,
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
        const rg = state.region;
        const loop = rg != null;
        const aw0 = rg ? ax.wallToAxis(rg.start) : 0;
        const aw1 = rg ? ax.wallToAxis(rg.end) : ax.total;
        const pa = ax.wallToAxis(playheadRef.current);
        const deltaA =
          Math.min(ts - last, 100) * ((aw1 - aw0) / 2300) * state.speed * state.playDir;
        const next = advancePlayhead({ a: pa, deltaA, a0: aw0, a1: aw1, loop });
        const live =
          next.kind === "stop" && cursorModeAtStop({ dir: state.playDir, loop }) === "live";
        // Catching up with the present must release time travel, or the page
        // keeps dropping commits and nothing is traced after the replay.
        setPlayhead(ax.axisToWall(next.a), !live);
        scheduleDraw(false);
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
  }, [state.playing, state.speed, state.playDir, state.region, scheduleDraw]);

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
        case "go-live":
          onCursor({ mode: "live", t: bounds.t1 });
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
  const phX = wToX(playheadRef.current);
  const loupe = loupeRef.current;
  const tip = tipRef.current;
  const narrow = sizeRef.current.w < 720;
  const fmt = (t: number) => Math.round(t - bounds.t0).toLocaleString("en-US");

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
          scheduleDraw(false);
        }}
      >
        <canvas ref={baseRef} style={{ display: "block" }} />
        <canvas ref={overRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

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

        {gapChips.map((s) => {
          const chipW = Math.max(s.x1 - s.x0 - 4, 56);
          const left = clamp(
            (s.x0 + s.x1) / 2 - chipW / 2,
            nameW() + 2,
            sizeRef.current.w - chipW - 2,
          );
          return (
            <div
              key={s.id}
              className="tl-gap"
              style={{
                left,
                top: RULER_H + 5,
                width: chipW,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => toggleGap(s.id)}
            >
              ◂ collapse
            </div>
          );
        })}

        {phX > nameW() && phX < sizeRef.current.w - 74 && (
          <div
            className="tl-ph-chip"
            style={{ left: phX + 8, top: RULER_H + 4, pointerEvents: "none" }}
          >
            t = {fmt(playheadRef.current)} ms
            {state.playing && state.speed !== 1 ? ` · ${state.speed}×` : ""}
          </div>
        )}

        {tip && (
          <div className="tl-tip" style={{ left: tip.x, top: tip.y }}>
            <div className="tl-tip-name">
              {tip.clip.name}
              {` #${tip.clip.componentId}`}
            </div>
            <div>
              <span style={{ color: CAUSE_VAR[clipCauseColor(tip.clip.cause)] }}>
                {clipCauseColor(tip.clip.cause)}
              </span>
              {tip.clip.wasted && <span style={{ color: "var(--warn)" }}> · wasted</span>}
            </div>
            <div className="tl-tip-meta">
              {fmt(tip.clip.t0)}–{fmt(tip.clip.t1)} ms · {tip.clip.total.toFixed(1)} ms total
              {tip.clip.self < tip.clip.total * 0.95
                ? ` · ${tip.clip.self.toFixed(1)} ms self`
                : ""}
              · row {(tip.clip.row ?? 0) + 1}
            </div>
          </div>
        )}

        {loupe && (
          <div
            className="tl-loupe"
            style={{
              left: loupe.x,
              top: Math.max(loupe.y, 2),
              width: 292,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              doFitWall(loupe.wallT - LOUPE_HALF_MS, loupe.wallT + LOUPE_HALF_MS);
              loupeRef.current = null;
            }}
          >
            <div className="tl-loupe-head">
              ↳ {fmt(loupe.wallT - LOUPE_HALF_MS)}–{fmt(loupe.wallT + LOUPE_HALF_MS)} ms · click to
              zoom
            </div>
            <canvas
              ref={loupeCvRef}
              style={{ display: "block", width: LOUPE_W, height: LOUPE_H }}
            />
          </div>
        )}

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
      />
    </div>
  );
}
