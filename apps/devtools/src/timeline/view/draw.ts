import type { CausalEdge } from "../model/edges.js";
import { clipCauseColor, type Clip } from "../model/lanes.js";
import type { TimeAxis, TimeSpan } from "../model/axis.js";
import { niceStep } from "../model/axis.js";
import type { LaneLayout } from "../model/rows.js";
import type { ViewWindow } from "../model/viewport.js";
import type { TimelineGeometryPayload } from "../timelineRendererClient.js";
import { semanticZoomForPxPerMs } from "../model/semanticZoom.js";
import { LANE_PAD, ROW_H, RULER_H } from "./metrics.js";
import { arrowSpanVisible, drawCausalArrow, planCausalArrows, routeCausalArrow } from "./arrows.js";
import { buildClipRect, buildWaveRect, computeClipRects, type ClipRect } from "./clipRects.js";
import { labelForClip, reserveLabelSpan, type LabelSpan } from "./clipLabels.js";
import { causeColor, clipPaint, hexAlpha, type TimelineTheme } from "./timelineTheme.js";
import { RenderFlags, causeCodeToName } from "@reactlens/trace-engine";

export type { ClipRect } from "./clipRects.js";
export type TimelineViewMode = "density" | "events" | "cost" | "causality";

export interface Projectors {
  aToX: (a: number) => number;
  wToX: (t: number) => number;
  nameW: number;
  stageW: number;
  pxPerMs: number;
}

export interface DrawBaseArgs {
  ctx: CanvasRenderingContext2D;
  axis: TimeAxis;
  view: ViewWindow;
  layout: LaneLayout;
  geometry?: TimelineGeometryPayload;
  region: TimeSpan | null;
  markers: ReadonlyArray<{ t: number; label: string; warn: boolean }>;
  selectedRender: string | number | null;
  proj: Projectors;
  pattern: CanvasPattern | null;
  tOrigin: number;
  theme: TimelineTheme;
  viewMode?: TimelineViewMode;
}

const fmt = (t: number) => Math.round(t).toLocaleString("en-US");

function lowerBoundMarker(markers: ReadonlyArray<{ t: number }>, target: number): number {
  let lo = 0;
  let hi = markers.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (markers[mid]!.t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function visibleAxisSegs(axis: TimeAxis, view: ViewWindow): TimeAxis["segs"] {
  const segs = axis.segs;
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (segs[mid]!.a1 < view.a0) lo = mid + 1;
    else hi = mid;
  }
  const out: TimeAxis["segs"] = [];
  for (let i = lo; i < segs.length; i++) {
    const seg = segs[i]!;
    if (seg.a0 > view.a1) break;
    out.push(seg);
  }
  return out;
}

function geometryRowRanges(
  layout: LaneLayout,
  geo: TimelineGeometryPayload,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = layout.rows.map(() => [0, 0]);
  const seen = new Uint8Array(layout.rows.length);
  for (let i = 0; i < geo.count; i++) {
    const ri = geo.rowIndex[i]!;
    if (ri >= ranges.length) continue;
    if (!seen[ri]) {
      ranges[ri] = [i, i + 1];
      seen[ri] = 1;
    } else {
      ranges[ri]![1] = i + 1;
    }
  }
  return ranges;
}

function clipFromGeometry(
  layout: LaneLayout,
  geo: TimelineGeometryPayload,
  i: number,
): Clip | null {
  const row = layout.rows[geo.rowIndex[i]!];
  if (!row) return null;
  const t0 = geo.x0[i]!;
  const t1 = geo.x1[i]!;
  return {
    renderId: geo.renderId[i]! as Clip["renderId"],
    componentId: geo.componentId[i]! as Clip["componentId"],
    laneKey: row.key,
    name: row.lane.name,
    t0,
    t1,
    self: geo.self[i]!,
    total: t1 - t0,
    cause: causeCodeToName(geo.cause[i]!),
    wasted: (geo.flags[i]! & RenderFlags.Wasted) !== 0,
    row: geo.stackRow[i]!,
    aggregate: geo.aggregate[i] === 1,
    renderCount: geo.renderCount[i]!,
    wastedCount: geo.wastedCount[i]!,
  };
}

function clipRectsFromGeometry(
  layout: LaneLayout,
  geo: TimelineGeometryPayload,
  ranges: ReadonlyArray<[number, number]>,
  proj: Projectors,
  detailed: boolean,
): { clipRects: Map<string, ClipRect>; snapEdges: number[] } {
  const clipRects = new Map<string, ClipRect>();
  const snapEdges: number[] = [];
  for (let ri = 0; ri < layout.rows.length; ri++) {
    const row = layout.rows[ri]!;
    const [start, end] = ranges[ri]!;
    for (let i = start; i < end; i++) {
      if (geo.aggregate[i] === 1) continue;
      const clip = clipFromGeometry(layout, geo, i);
      if (!clip) continue;
      const x0 = proj.wToX(clip.t0);
      const x1 = proj.wToX(clip.t1);
      if (row.mode === "wave" && !detailed) {
        const centerX = proj.wToX(clip.t0 + Math.max(clip.self, 0.15) / 2);
        clipRects.set(String(clip.renderId), buildWaveRect(clip, centerX, row.y + row.h / 2));
      } else {
        const clipH = ROW_H - 6;
        const stackRow = detailed
          ? (clip.row ?? 0) % Math.max(1, Math.floor((row.h - LANE_PAD) / ROW_H))
          : 0;
        const y = row.y + LANE_PAD / 2 + stackRow * ROW_H + 1.5;
        clipRects.set(
          String(clip.renderId),
          buildClipRect(clip, x0, y, clipH, Math.max(0, x1 - x0)),
        );
      }
      snapEdges.push(clip.t0, clip.t1);
    }
  }
  return { clipRects, snapEdges };
}

export function ensureHatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const p =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(6, 6)
      : document.createElement("canvas");
  p.width = p.height = 6;
  const pc = p.getContext("2d");
  if (!pc) return null;
  pc.strokeStyle = "rgba(150,150,160,.30)";
  pc.lineWidth = 1.4;
  pc.beginPath();
  pc.moveTo(-2, 8);
  pc.lineTo(8, -2);
  pc.stroke();
  return ctx.createPattern(p as CanvasImageSource, "repeat");
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawClipFill(
  ctx: CanvasRenderingContext2D,
  rect: ClipRect,
  theme: TimelineTheme,
  pattern: CanvasPattern | null,
  costMode: boolean,
): void {
  const c = rect.clip;
  const col = causeColor(theme, clipCauseColor(c.cause));
  const paint = clipPaint(theme, col);
  const r = rect.visual;
  ctx.save();
  if (costMode) ctx.globalAlpha = Math.min(1, 0.28 + c.self / Math.max(c.total, 0.001));

  if (rect.representation === "tick") {
    ctx.fillStyle = c.wasted ? theme.warn : col;
    ctx.fillRect(Math.round(r.x), r.y, Math.max(1, r.width), r.height);
    ctx.restore();
    return;
  }

  if (c.wasted && pattern) {
    ctx.fillStyle = hexAlpha(theme.warn, 0.14);
    roundRect(ctx, r.x, r.y, r.width, r.height, 4);
    ctx.fill();
    ctx.fillStyle = pattern;
    ctx.fill();
    ctx.strokeStyle = hexAlpha(theme.warn, 0.55);
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const grad = ctx.createLinearGradient(0, r.y, 0, r.y + r.height);
    grad.addColorStop(0, paint.fillTop);
    grad.addColorStop(1, paint.fillBottom);
    ctx.fillStyle = grad;
    roundRect(ctx, r.x, r.y, r.width, r.height, 4);
    ctx.fill();
    ctx.strokeStyle = paint.stroke;
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  rect: ClipRect,
  theme: TimelineTheme,
): void {
  const r = rect.visual;
  ctx.save();
  ctx.shadowColor = hexAlpha(theme.accent, 0.6);
  ctx.shadowBlur = 8;
  ctx.lineWidth = 5;
  ctx.strokeStyle = hexAlpha(theme.accent, 0.32);
  roundRect(ctx, r.x - 3, r.y - 3, r.width + 6, r.height + 6, 7);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.accent;
  roundRect(ctx, r.x - 2, r.y - 2, r.width + 4, r.height + 4, 7);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = hexAlpha(theme.text, 0.92);
  roundRect(ctx, r.x - 0.5, r.y - 0.5, r.width + 1, r.height + 1, 5.5);
  ctx.stroke();
  ctx.restore();
}

function drawDensityRow(
  ctx: CanvasRenderingContext2D,
  clips: readonly Clip[],
  row: LaneLayout["rows"][number],
  proj: Projectors,
  theme: TimelineTheme,
): void {
  const binW = 4;
  const n = Math.max(1, Math.ceil((proj.stageW - proj.nameW) / binW));
  const bins = new Float32Array(n);
  let max = 1;
  for (const clip of clips) {
    const x = proj.wToX(clip.t0);
    const bi = Math.floor((x - proj.nameW) / binW);
    if (bi < 0 || bi >= n) continue;
    bins[bi] = (bins[bi] ?? 0) + Math.max(1, clip.renderCount ?? 1);
    max = Math.max(max, bins[bi]!);
  }
  for (let i = 0; i < n; i++) {
    const value = bins[i]!;
    if (!value) continue;
    const hh = 3 + (value / max) * Math.max(6, row.h - 14);
    ctx.fillStyle = hexAlpha(theme.context, 0.3 + 0.45 * (value / max));
    ctx.fillRect(proj.nameW + i * binW, row.y + row.h - 4 - hh, binW - 1, hh);
  }
}

export function drawBase(args: DrawBaseArgs): {
  clipRects: Map<string, ClipRect>;
  snapEdges: number[];
} {
  const { ctx, axis, view, layout, geometry, region, markers, proj, tOrigin, theme } = args;
  const viewMode = args.viewMode ?? "events";
  const H = layout.paintH ?? layout.totalH;
  const { nameW: NW, stageW: W, wToX, aToX, pxPerMs } = proj;
  const segs = visibleAxisSegs(axis, view);
  const semantic = semanticZoomForPxPerMs(pxPerMs);
  const detailed = semantic === "renders" || semantic === "details";
  const geoRanges = geometry ? geometryRowRanges(layout, geometry) : null;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  for (const s of segs) {
    if (s.type !== "gap" || s.a1 - s.a0 < 1e-6) continue;
    const x0 = aToX(s.a0);
    const x1 = aToX(s.a1);
    ctx.fillStyle = hexAlpha(theme.lineStrong, 0.12);
    ctx.fillRect(x0, RULER_H, x1 - x0, H - RULER_H);
  }

  if (region) {
    const x0 = wToX(region.start);
    const x1 = wToX(region.end);
    ctx.fillStyle = hexAlpha(theme.accent, 0.055);
    ctx.fillRect(x0, 0, x1 - x0, H);
    ctx.strokeStyle = hexAlpha(theme.accent, 0.4);
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, H);
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, H);
    ctx.stroke();
  }

  ctx.strokeStyle = hexAlpha(theme.lineStrong, 0.7);
  ctx.beginPath();
  ctx.moveTo(0, RULER_H - 0.5);
  ctx.lineTo(W, RULER_H - 0.5);
  ctx.stroke();

  let lastLabelX = -Infinity;
  for (const s of segs) {
    if (s.type !== "act") continue;
    const step = niceStep(110 / Math.max(pxPerMs, 1e-6));
    const minor = step / 5;
    for (let t = Math.ceil(s.w0 / minor) * minor; t <= s.w1; t += minor) {
      const x = wToX(t);
      if (x < NW || x > W) continue;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ctx.strokeStyle = major ? hexAlpha(theme.lineStrong, 0.8) : hexAlpha(theme.line, 0.7);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, RULER_H - (major ? 10 : 5));
      ctx.lineTo(Math.round(x) + 0.5, H);
      ctx.stroke();
      if (major && x - lastLabelX > 54) {
        ctx.fillStyle = theme.text3;
        ctx.font = `9.5px ${theme.mono}`;
        ctx.fillText(`${fmt(t - tOrigin)}ms`, x + 4, RULER_H - 12);
        lastLabelX = x;
      }
    }
  }

  const markerRows: Array<Array<{ left: number; right: number }>> = [[], []];
  for (const s of segs) {
    if (s.type !== "act") continue;
    const lo = lowerBoundMarker(markers, s.w0);
    const hi = lowerBoundMarker(markers, s.w1 + Number.EPSILON);
    for (let i = lo; i < hi; i++) {
      const m = markers[i]!;
      const x = wToX(m.t);
      if (x < NW || x > W) continue;
      ctx.fillStyle = m.warn ? theme.warn : theme.accent;
      ctx.beginPath();
      ctx.moveTo(x, 5);
      ctx.lineTo(x + 4, 9);
      ctx.lineTo(x, 13);
      ctx.lineTo(x - 4, 9);
      ctx.closePath();
      ctx.fill();
      if (semantic === "session") continue;
      ctx.font = `9px ${theme.mono}`;
      const width = ctx.measureText(m.label).width;
      const left = x + 8;
      const right = left + width;
      const row = markerRows.findIndex((spans) =>
        spans.every((r) => right + 8 <= r.left || left >= r.right + 8),
      );
      if (row >= 0) {
        markerRows[row]!.push({ left, right });
        ctx.fillStyle = m.warn ? theme.warn : theme.text3;
        ctx.fillText(m.label, left, 14 + row * 11);
      }
    }
  }

  const { clipRects, snapEdges } =
    geometry && geoRanges
      ? clipRectsFromGeometry(layout, geometry, geoRanges, proj, detailed)
      : computeClipRects(layout, proj);
  const rectsByLane = new Map<string, ClipRect[]>();
  for (const rect of clipRects.values()) {
    const key = String(rect.clip.laneKey);
    const laneRects = rectsByLane.get(key);
    if (laneRects) laneRects.push(rect);
    else rectsByLane.set(key, [rect]);
  }

  for (const row of layout.rows) {
    ctx.strokeStyle = hexAlpha(theme.line, 0.55);
    ctx.beginPath();
    ctx.moveTo(0, row.y + row.h - 0.5);
    ctx.lineTo(W, row.y + row.h - 0.5);
    ctx.stroke();

    const useDensity =
      viewMode === "density" || semantic === "session" || semantic === "interactions";
    if (useDensity) {
      drawDensityRow(ctx, row.clips, row, proj, theme);
      continue;
    }

    const labelSpans: LabelSpan[] = [];
    for (const rect of rectsByLane.get(String(row.key)) ?? []) {
      if (rect.visual.x + rect.visual.width < NW || rect.visual.x > W) continue;
      drawClipFill(ctx, rect, theme, args.pattern, viewMode === "cost");
      const text = labelForClip(rect.visual.width, rect.clip);
      if (!text) continue;
      ctx.font = `600 9px ${theme.mono}`;
      const tw = ctx.measureText(text).width;
      if (tw > rect.visual.width - 10) continue;
      const left = rect.visual.x + 5;
      const right = left + tw;
      if (!reserveLabelSpan(labelSpans, left, right)) continue;
      ctx.fillStyle = rect.clip.wasted
        ? theme.warn
        : clipPaint(theme, causeColor(theme, clipCauseColor(rect.clip.cause))).label;
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        rect.visual.x + 3,
        rect.visual.y,
        Math.max(0, rect.visual.width - 6),
        rect.visual.height,
      );
      ctx.clip();
      ctx.fillText(text, left, rect.visual.y + rect.visual.height / 2 + 3);
      ctx.restore();
    }
  }

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, NW, H);
  ctx.strokeStyle = hexAlpha(theme.lineStrong, 0.75);
  ctx.beginPath();
  ctx.moveTo(NW - 0.5, 0);
  ctx.lineTo(NW - 0.5, H);
  ctx.stroke();

  return { clipRects, snapEdges };
}

export interface DrawOverlayArgs {
  ctx: CanvasRenderingContext2D;
  stageW: number;
  totalH: number;
  nameW: number;
  clipRects: Map<string, ClipRect>;
  edges: readonly CausalEdge[];
  selectedRender: string | number | null;
  marquee: { x0: number; x1: number } | null;
  hoverId: string | null;
  ghostT: number | null;
  playheadT: number;
  wToX: (t: number) => number;
  dragging: boolean;
  theme: TimelineTheme;
  viewMode?: TimelineViewMode;
}

export function drawOverlay(args: DrawOverlayArgs): void {
  const {
    ctx,
    stageW: W,
    totalH: H,
    nameW: NW,
    clipRects,
    edges,
    selectedRender,
    marquee,
    hoverId,
    ghostT,
    playheadT,
    wToX,
    dragging,
    theme,
  } = args;
  const viewMode = args.viewMode ?? "events";
  ctx.clearRect(0, 0, W, H);

  const sel = selectedRender != null ? String(selectedRender) : null;
  const shouldDrawArrows = viewMode === "causality" || (viewMode === "events" && sel != null);
  if (shouldDrawArrows) {
    const edgeList = edges
      .filter(
        (e) => !sel || viewMode === "causality" || String(e.from) === sel || String(e.to) === sel,
      )
      .slice(0, 100)
      .map((e) => ({ from: String(e.from), to: String(e.to), causeKey: clipCauseColor(e.cause) }));
    const ports = new Map(
      [...clipRects.entries()].map(([id, r]) => [
        id,
        {
          x0: r.x0,
          x1: r.x1,
          y0: r.y0,
          y1: r.y1,
          t0: r.clip.t0,
          wave: r.wave,
          laneKey: String(r.clip.laneKey),
        },
      ]),
    );
    for (const p of planCausalArrows(edgeList, ports)) {
      if (!arrowSpanVisible(p.from, p.to, NW, W)) continue;
      const route = routeCausalArrow(p.from, p.to, p.slot, p.slotCount);
      drawCausalArrow({
        ctx,
        x1: route.x1,
        y1: route.y1,
        x2: route.x2,
        y2: route.y2,
        side: route.side,
        fanSpread: route.fanSpread,
        color: hexAlpha(theme.accent, 0.9),
        lineWidth: p.slotCount > 6 ? 1.05 : 1.3,
        headSize: 7,
        orderLabel: p.order,
      });
    }
  }

  if (marquee) {
    const x0 = Math.min(marquee.x0, marquee.x1);
    const x1 = Math.max(marquee.x0, marquee.x1);
    ctx.fillStyle = hexAlpha(theme.accent, 0.08);
    ctx.fillRect(x0, RULER_H, x1 - x0, H - RULER_H);
    ctx.strokeStyle = hexAlpha(theme.accent, 0.6);
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0 + 0.5, RULER_H + 0.5, x1 - x0 - 1, H - RULER_H - 1);
    ctx.setLineDash([]);
  }

  const hv = hoverId ? clipRects.get(hoverId) : null;
  if (hv && String(hv.clip.renderId) !== sel) {
    const r = hv.visual;
    ctx.strokeStyle = hexAlpha(theme.text, 0.65);
    ctx.lineWidth = 1;
    roundRect(ctx, r.x - 1, r.y - 1, r.width + 2, r.height + 2, 5);
    ctx.stroke();
  }

  if (sel) {
    const selected = clipRects.get(sel);
    if (selected) drawSelectionRing(ctx, selected, theme);
  }

  if (ghostT != null && !dragging) {
    const gx = wToX(ghostT);
    if (gx > NW && gx < W) {
      ctx.strokeStyle = hexAlpha(theme.accent, 0.18);
      ctx.beginPath();
      ctx.moveTo(Math.round(gx) + 0.5, 0);
      ctx.lineTo(Math.round(gx) + 0.5, H);
      ctx.stroke();
    }
  }

  const x = wToX(playheadT);
  if (x >= NW && x <= W) {
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 7);
    ctx.closePath();
    ctx.fill();
  }
}
