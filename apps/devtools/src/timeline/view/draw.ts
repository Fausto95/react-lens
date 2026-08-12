/**
 * Canvas base-layer paint: gaps, region, ruler, markers, lanes (stack/wave).
 */

import type { CausalEdge } from "../model/edges.js";
import type { Clip } from "../model/lanes.js";
import { clipCauseColor } from "../model/lanes.js";
import type { TimeAxis } from "../model/axis.js";
import { niceStep } from "../model/axis.js";
import type { LaneLayout } from "../model/rows.js";
import type { TimeSpan } from "../model/axis.js";
import type { ViewWindow } from "../model/viewport.js";
import { waveBins } from "../model/wave.js";
import {
  LANE_PAD,
  MIN_CLIP_PX,
  ROW_H,
  RULER_H,
} from "./metrics.js";
import { drawCausalArrow, planCausalArrows, routeCausalArrow } from "./arrows.js";
import { causeColor, clipPaint, hexAlpha, type TimelineTheme } from "./timelineTheme.js";

export interface ClipRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  clip: Clip;
  /** True when the port is a wave-lane stand-in (no stack bar). */
  wave?: boolean;
}

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
  region: TimeSpan | null;
  markers: ReadonlyArray<{ t: number; label: string; warn: boolean }>;
  selectedRender: string | number | null;
  proj: Projectors;
  pattern: CanvasPattern | null;
  /** Session-relative origin for labels (bounds.t0). */
  tOrigin: number;
  theme: TimelineTheme;
}

const fmt = (t: number) => Math.round(t).toLocaleString("en-US");

export function ensureHatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const p = document.createElement("canvas");
  p.width = p.height = 6;
  const pc = p.getContext("2d");
  if (!pc) return null;
  pc.strokeStyle = "rgba(150,150,160,.30)";
  pc.lineWidth = 1.4;
  pc.beginPath();
  pc.moveTo(-2, 8);
  pc.lineTo(8, -2);
  pc.stroke();
  return ctx.createPattern(p, "repeat");
}

export function drawBase(args: DrawBaseArgs): {
  clipRects: Map<string, ClipRect>;
  snapEdges: number[];
} {
  const { ctx, axis, layout, region, markers, selectedRender, proj, tOrigin, theme } = args;
  const { nameW: NW, stageW: W, wToX, aToX, pxPerMs } = proj;
  const H = layout.totalH;
  const pattern = args.pattern;
  const MONO = theme.mono;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  const hline = (y: number, style: string) => {
    ctx.strokeStyle = style;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  };
  const vline = (x: number, y0: number, y1: number, style: string, dash?: number[]) => {
    ctx.strokeStyle = style;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, y0);
    ctx.lineTo(Math.round(x) + 0.5, y1);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  };

  for (const s of axis.segs) {
    if (s.type !== "gap") continue;
    // Collapsed gaps have zero axis width — skip. Only paint when expanded to wall.
    if (s.a1 - s.a0 < 1e-6) continue;
    const x0 = aToX(s.a0);
    const x1 = aToX(s.a1);
    if (x1 < NW || x0 > W) continue;
    ctx.fillStyle = hexAlpha(theme.lineStrong, 0.14);
    ctx.fillRect(x0, RULER_H, x1 - x0, H - RULER_H);
    vline(x0, RULER_H, H, hexAlpha(theme.lineStrong, 0.65), [2, 4]);
    vline(x1, RULER_H, H, hexAlpha(theme.lineStrong, 0.65), [2, 4]);
  }

  if (region) {
    const x0 = wToX(region.start);
    const x1 = wToX(region.end);
    ctx.fillStyle = hexAlpha(theme.accent, 0.05);
    ctx.fillRect(x0, 0, x1 - x0, H);
    vline(x0, 0, H, hexAlpha(theme.accent, 0.4));
    vline(x1, 0, H, hexAlpha(theme.accent, 0.4));
    ctx.fillStyle = hexAlpha(theme.accent, 0.65);
    ctx.font = `8.5px ${MONO}`;
    ctx.fillText("I", x0 + 3, 9);
    ctx.fillText("O", x1 - 9, 9);
  }

  hline(RULER_H - 1, hexAlpha(theme.lineStrong, 0.75));

  // Compressed idle stitches: hairline so wall-time jumps stay visible.
  for (const s of axis.segs) {
    if (s.type !== "gap" || s.a1 - s.a0 >= 1e-6) continue;
    const x = aToX(s.a0);
    if (x < NW || x > W) continue;
    vline(x, RULER_H, H, hexAlpha(theme.lineStrong, 0.4), [2, 3]);
    ctx.fillStyle = hexAlpha(theme.text3, 0.85);
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.lineTo(x + 3.5, 7);
    ctx.lineTo(x, 12);
    ctx.lineTo(x - 3.5, 7);
    ctx.closePath();
    ctx.fill();
  }

  // Ruler ticks + labels; cull major labels that would collide at stitches.
  const LABEL_MIN_PX = 44;
  let lastLabelX = -Infinity;
  for (const s of axis.segs) {
    if (s.type !== "act") continue;
    const step = niceStep(70 / Math.max(pxPerMs, 1e-6));
    const minor = step / 5;
    for (let t = Math.ceil(s.w0 / minor) * minor; t <= s.w1; t += minor) {
      const x = wToX(t);
      if (x < NW || x > W) continue;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      vline(
        x,
        RULER_H - (major ? 8 : 4),
        RULER_H,
        major ? hexAlpha(theme.lineStrong, 0.9) : hexAlpha(theme.line, 0.85),
      );
      if (major && x - lastLabelX >= LABEL_MIN_PX) {
        ctx.fillStyle = theme.text3;
        ctx.font = `9.5px ${MONO}`;
        ctx.fillText(fmt(t - tOrigin), x + 4, RULER_H - 11);
        lastLabelX = x;
      }
    }
  }

  for (const m of markers) {
    const x = wToX(m.t);
    if (x < NW || x > W) continue;
    ctx.fillStyle = m.warn ? theme.warn : theme.text2;
    ctx.beginPath();
    ctx.moveTo(x, 5);
    ctx.lineTo(x + 4, 9);
    ctx.lineTo(x, 13);
    ctx.lineTo(x - 4, 9);
    ctx.closePath();
    ctx.fill();
    if (pxPerMs > 0.3) {
      ctx.fillStyle = m.warn ? theme.warn : theme.text3;
      ctx.font = `9px ${MONO}`;
      ctx.fillText(m.label, x + 8, 12);
    }
  }

  const clipRects = new Map<string, ClipRect>();
  const snapEdges: number[] = [];

  for (const row of layout.rows) {
    hline(row.y + row.h - 1, hexAlpha(theme.line, 0.55));
    if (row.mode === "wave") {
      const { bins, max } = waveBins(row.clips, wToX, NW, W, 3);
      const mid = row.y + row.h / 2;
      ctx.globalAlpha = row.dim ? 0.25 : 1;
      for (let b = 0; b < bins.length; b++) {
        const bin = bins[b]!;
        if (!bin.count) continue;
        const hh = 2 + (bin.count / max) * (row.h - 16);
        const ratio = bin.wasted / bin.count;
        ctx.fillStyle =
          ratio > 0.3 ? hexAlpha(theme.bad, 0.55) : hexAlpha(theme.props, 0.5);
        const x = NW + b * 3;
        roundRect(ctx, x, mid - hh / 2, 2.3, hh, 1.2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Wave ports so causality can still aim at the group when bars aren't drawn.
      for (const c of row.clips) {
        const xc = wToX((c.t0 + c.t1) / 2);
        if (xc < NW - 4 || xc > W + 4) continue;
        clipRects.set(String(c.renderId), {
          x0: xc - 3,
          x1: xc + 3,
          y0: mid - 8,
          y1: mid + 8,
          clip: c,
          wave: true,
        });
        snapEdges.push(c.t0, c.t1);
      }
      continue;
    }

    for (const c of row.clips) {
      const x0 = wToX(c.t0);
      const x1 = wToX(c.t1);
      if (x1 < NW || x0 > W) continue;
      const w = Math.max(x1 - x0, MIN_CLIP_PX);
      const clipH = ROW_H - 6;
      const cy = row.y + LANE_PAD / 2 + (c.row ?? 0) * ROW_H + 1.5;
      const col = causeColor(theme, clipCauseColor(c.cause));
      const paint = clipPaint(theme, col);
      ctx.globalAlpha = row.dim ? 0.25 : 1;

      if (c.wasted && pattern) {
        ctx.fillStyle = pattern;
        roundRect(ctx, x0, cy, w, clipH, 4);
        ctx.fill();
        ctx.strokeStyle = hexAlpha(theme.text3, 0.55);
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const grad = ctx.createLinearGradient(0, cy, 0, cy + clipH);
        grad.addColorStop(0, paint.fillTop);
        grad.addColorStop(1, paint.fillBottom);
        ctx.fillStyle = grad;
        roundRect(ctx, x0, cy, w, clipH, 4);
        ctx.fill();
        ctx.strokeStyle = paint.stroke;
        ctx.stroke();
        if (w > 74) {
          let px = x0 + 1;
          const barAlpha = theme.light ? 0.65 : 0.55;
          for (const frac of [0.6, 0.25, 0.15] as const) {
            ctx.fillStyle = hexAlpha(col, barAlpha);
            roundRect(ctx, px, cy + clipH - 4.5, frac * (w - 2), 3, 1.5);
            ctx.fill();
            px += frac * (w - 2);
          }
        }
      }

      if (selectedRender === c.renderId) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = hexAlpha(theme.accent, 0.5);
        ctx.shadowBlur = 6;
        roundRect(ctx, x0 - 1.5, cy - 1.5, w + 3, clipH + 3, 5);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
      }

      if (w > 48) {
        ctx.fillStyle = c.wasted ? hexAlpha(theme.text3, 0.85) : paint.label;
        ctx.font = `9px ${MONO}`;
        const lbl = c.wasted
          ? "wasted"
          : `${clipCauseColor(c.cause)} · ${c.total.toFixed(0)}ms`;
        ctx.fillText(lbl.slice(0, Math.floor(w / 5.5)), x0 + 5, cy + clipH / 2 + 3);
      }
      ctx.globalAlpha = 1;
      const id = String(c.renderId);
      clipRects.set(id, { x0, x1: x0 + w, y0: cy, y1: cy + clipH, clip: c });
      snapEdges.push(c.t0, c.t1);
    }
  }

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, NW, H);
  vline(NW - 1, 0, H, hexAlpha(theme.lineStrong, 0.75));

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

  ctx.clearRect(0, 0, W, H);

  const sel = selectedRender != null ? String(selectedRender) : null;
  const edgeList = edges
    .filter((e) => {
      const a = String(e.from);
      const b = String(e.to);
      if (sel && a !== sel && b !== sel) return false;
      return true;
    })
    .map((e) => ({
      from: String(e.from),
      to: String(e.to),
      causeKey: clipCauseColor(e.cause),
    }));

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

  const planned = planCausalArrows(edgeList, ports);
  for (const p of planned) {
    const route = routeCausalArrow(p.from, p.to, p.slot, p.slotCount);
    const col = hexAlpha(causeColor(theme, p.causeKey), 0.92);
    drawCausalArrow({
      ctx,
      x1: route.x1,
      y1: route.y1,
      x2: route.x2,
      y2: route.y2,
      side: route.side,
      fanSpread: route.fanSpread,
      color: col,
      lineWidth: p.slotCount > 6 ? 1.1 : 1.35,
      headSize: 7,
      orderLabel: p.order,
    });
  }

  if (marquee) {
    const x0 = Math.min(marquee.x0, marquee.x1);
    const x1 = Math.max(marquee.x0, marquee.x1);
    ctx.fillStyle = hexAlpha(theme.accent, 0.09);
    ctx.fillRect(x0, RULER_H, x1 - x0, H - RULER_H);
    ctx.strokeStyle = hexAlpha(theme.accent, 0.6);
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0 + 0.5, RULER_H + 0.5, x1 - x0 - 1, H - RULER_H - 1);
    ctx.setLineDash([]);
  }

  const hv = hoverId && clipRects.get(hoverId);
  if (hv) {
    ctx.strokeStyle = hexAlpha(theme.text, theme.light ? 0.45 : 0.55);
    roundRect(ctx, hv.x0 - 0.5, hv.y0 - 0.5, hv.x1 - hv.x0 + 1, hv.y1 - hv.y0 + 1, 4.5);
    ctx.stroke();
  }

  if (ghostT != null && !dragging) {
    const gx = wToX(ghostT);
    if (gx > NW) {
      ctx.strokeStyle = hexAlpha(theme.accent, 0.22);
      ctx.beginPath();
      ctx.moveTo(Math.round(gx) + 0.5, 0);
      ctx.lineTo(Math.round(gx) + 0.5, H);
      ctx.stroke();
    }
  }

  const x = wToX(playheadT);
  if (x >= NW && x <= W) {
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = hexAlpha(theme.accent, 0.55);
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(x - 5.5, 0);
    ctx.lineTo(x + 5.5, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
  }
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
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}
