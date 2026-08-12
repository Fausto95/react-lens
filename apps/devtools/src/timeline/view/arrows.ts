/**
 * Causal arrow geometry — side-attached cubic arcs with tangent-aligned heads.
 *
 * Routing:
 * - Single parent→child down: left-side C-curve
 * - Fan-out down (several effects): right-side C-curves with spreading bows
 * - Child→parent up: right-side C-curve
 * - Forward in time: exit right of source → enter left of target
 * - Fan-out order: ports along the source edge + ordinal badge at the port
 */

import type { ClipCauseColor } from "../model/lanes.js";

export interface Point {
  x: number;
  y: number;
}

export function cubicAt(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

export function cubicTangent(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

export type ArrowSide = "left" | "right" | "forward";

/** Cubic controls for a side-attached or forward causal arc. */
export function causalBezierPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side: ArrowSide = "forward",
  /** Extra outward bow for later fan-out slots (px). */
  fanSpread = 0,
): [Point, Point, Point, Point] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const p0: Point = { x: x1, y: y1 };
  const p3: Point = { x: x2, y: y2 };

  if (side === "left" || side === "right") {
    const outward = side === "left" ? -1 : 1;
    const handle = Math.min(130, Math.max(22, Math.abs(dy) * 0.22 + 18 + fanSpread));
    const p1: Point = { x: x1 + outward * handle, y: y1 };
    const p2: Point = { x: x2 + outward * handle * 0.85, y: y2 };
    return [p0, p1, p2, p3];
  }

  const handle = Math.min(120, Math.max(28, Math.abs(dx) * 0.45 + Math.abs(dy) * 0.12));
  const sign = dx >= 0 ? 1 : -1;
  const p1: Point = { x: x1 + sign * handle, y: y1 };
  const p2: Point = { x: x2 - sign * handle, y: y2 };
  if (dist < 1) {
    p1.y += 8;
    p2.y -= 8;
  }
  return [p0, p1, p2, p3];
}

export function tangentAngle(tangent: Point): number {
  return Math.atan2(tangent.y, tangent.x);
}

export interface ClipPorts {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ArrowRoute {
  side: ArrowSide;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Extra bow for this fan-out slot. */
  fanSpread: number;
}

/**
 * Pick attachment sides. Fan-outs go down the right (sketch); a lone downward
 * link hugs the left; upward links hug the right.
 */
export function routeCausalArrow(
  from: ClipPorts,
  to: ClipPorts,
  slot = 1,
  slotCount = 1,
): ArrowRoute {
  const dyMid = (to.y0 + to.y1) / 2 - (from.y0 + from.y1) / 2;
  const overlapX = Math.min(from.x1, to.x1) - Math.max(from.x0, to.x0);
  const minW = Math.min(from.x1 - from.x0, to.x1 - to.x0, 1);
  const stacked = overlapX > minW * 0.3 || to.x0 < from.x1 - 4;

  // Spread ports along the source edge so many arrows don't share one pixel.
  const srcH = Math.max(from.y1 - from.y0, 1);
  const t = slotCount <= 1 ? 0.5 : slot / (slotCount + 1);
  const y1 = from.y0 + srcH * t;
  const y2 = (to.y0 + to.y1) / 2;
  const fanSpread = slotCount > 1 ? (slot - 1) * 12 : 0;

  if (stacked && Math.abs(dyMid) > 8) {
    let side: "left" | "right";
    if (dyMid > 0) {
      // Down: fan-out on the right; a single child on the left.
      side = slotCount > 1 ? "right" : "left";
    } else {
      side = "right";
    }

    if (side === "left") {
      return {
        side,
        x1: from.x0 + 2,
        y1,
        x2: to.x0 + 2,
        y2,
        fanSpread,
      };
    }
    return {
      side,
      x1: from.x1 - 2,
      y1,
      x2: to.x1 - 2,
      y2,
      fanSpread,
    };
  }

  return {
    side: "forward",
    x1: from.x1 - 2,
    y1,
    x2: to.x0 + 2,
    y2,
    fanSpread: 0,
  };
}

export interface DrawCausalArrowArgs {
  ctx: CanvasRenderingContext2D;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  side?: ArrowSide;
  fanSpread?: number;
  lineWidth?: number;
  headSize?: number;
  /** 1-based ordinal for causal sequence (always drawn, including lone arrows). */
  orderLabel?: number;
}

export interface ArrowEndpoint {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Clip start — used to order the global causal sequence. */
  t0?: number;
  wave?: boolean;
  laneKey?: string;
}

export interface PlannedArrow {
  from: ArrowEndpoint;
  to: ArrowEndpoint;
  /** Fan slot among arrows leaving this source (1-based) — geometry only. */
  slot: number;
  slotCount: number;
  /**
   * Global 1-based sequence across every visible arrow, ordered by when the
   * effect landed. Distinct from `slot` (per-source fan layout).
   */
  order: number;
  /** Collapsed wave-group size. */
  waveCount?: number;
  causeKey: ClipCauseColor;
}

/**
 * Build drawable arrows: stack fan-outs stay 1:1 with order slots; edges into the
 * same wave lane collapse to one arrow aimed at the wave group.
 *
 * `slot`/`slotCount` spread ports on a shared source. `order` numbers the full
 * visible chain so state→props→context reads 1, 2 — not 1, 1.
 */
export function planCausalArrows(
  edges: ReadonlyArray<{ from: string; to: string; causeKey: ClipCauseColor }>,
  ports: ReadonlyMap<string, ArrowEndpoint>,
): PlannedArrow[] {
  const resolved = edges
    .map((e) => {
      const from = ports.get(e.from);
      const to = ports.get(e.to);
      if (!from || !to) return null;
      return { from, to, fromId: e.from, toId: e.to, causeKey: e.causeKey };
    })
    .filter((e): e is NonNullable<typeof e> => e != null);

  const waveGroups = new Map<string, typeof resolved>();
  const stackEdges: typeof resolved = [];

  for (const e of resolved) {
    if (e.to.wave && e.to.laneKey) {
      const key = `${e.fromId}>${e.to.laneKey}`;
      const list = waveGroups.get(key) ?? [];
      list.push(e);
      waveGroups.set(key, list);
    } else {
      stackEdges.push(e);
    }
  }

  const drafts: Array<{
    fromId: string;
    from: ArrowEndpoint;
    to: ArrowEndpoint;
    causeKey: ClipCauseColor;
    waveCount?: number;
    sortT: number;
  }> = [];

  for (const group of waveGroups.values()) {
    const first = group[0]!;
    const midX = group.reduce((s, g) => s + (g.to.x0 + g.to.x1) / 2, 0) / group.length;
    const y0 = Math.min(...group.map((g) => g.to.y0));
    const y1 = Math.max(...group.map((g) => g.to.y1));
    const sortT = Math.min(...group.map((g) => g.to.t0 ?? Number.POSITIVE_INFINITY));
    drafts.push({
      fromId: first.fromId,
      from: first.from,
      to: {
        x0: midX - 4,
        x1: midX + 4,
        y0,
        y1,
        t0: Number.isFinite(sortT) ? sortT : first.to.t0,
        wave: true,
        laneKey: first.to.laneKey,
      },
      causeKey: first.causeKey,
      waveCount: group.length,
      sortT: Number.isFinite(sortT) ? sortT : 0,
    });
  }

  for (const e of stackEdges) {
    drafts.push({
      fromId: e.fromId,
      from: e.from,
      to: e.to,
      causeKey: e.causeKey,
      sortT: e.to.t0 ?? e.from.t0 ?? 0,
    });
  }

  // Fan geometry: per-source slots.
  const outTotal = new Map<string, number>();
  const outIndex = new Map<(typeof drafts)[number], number>();
  for (const d of drafts) {
    const n = (outTotal.get(d.fromId) ?? 0) + 1;
    outTotal.set(d.fromId, n);
    outIndex.set(d, n);
  }

  // Global sequence: when each effect landed.
  const byTime = [...drafts].sort((a, b) => a.sortT - b.sortT || a.fromId.localeCompare(b.fromId));
  const orderOf = new Map<(typeof drafts)[number], number>();
  byTime.forEach((d, i) => orderOf.set(d, i + 1));

  return drafts.map((d) => ({
    from: d.from,
    to: d.to,
    slot: outIndex.get(d) ?? 1,
    slotCount: outTotal.get(d.fromId) ?? 1,
    order: orderOf.get(d) ?? 1,
    ...(d.waveCount != null ? { waveCount: d.waveCount } : {}),
    causeKey: d.causeKey,
  }));
}

/**
 * Stroke a cubic causal arrow and place a filled head aligned to the curve tangent.
 */
export function drawCausalArrow(args: DrawCausalArrowArgs): void {
  const {
    ctx,
    x1,
    y1,
    x2,
    y2,
    color,
    side = "forward",
    fanSpread = 0,
    lineWidth = 1.35,
    headSize = 7,
    orderLabel,
  } = args;
  const [p0, p1, p2, p3] = causalBezierPoints(x1, y1, x2, y2, side, fanSpread);

  const tan = cubicTangent(0.995, p0, p1, p2, p3);
  const angle = tangentAngle(tan);
  const len = Math.hypot(tan.x, tan.y) || 1;
  const inset = headSize * 0.85;
  const tip = {
    x: p3.x - (tan.x / len) * inset,
    y: p3.y - (tan.y / len) * inset,
  };

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = orderLabel != null && orderLabel > 6 ? 0.55 : 1;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, tip.x, tip.y);
  ctx.stroke();

  const halfW = headSize * 0.44;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p3.x - headSize * cos + halfW * sin, p3.y - headSize * sin - halfW * cos);
  ctx.lineTo(p3.x - headSize * cos - halfW * sin, p3.y - headSize * sin + halfW * cos);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Badge sits on the source port — not the curve apex — so fan-outs stay readable.
  if (orderLabel != null && orderLabel > 0) {
    const outward = side === "left" ? -1 : 1;
    const lx = x1 + outward * 9;
    const ly = y1;
    ctx.font = "bold 8px ui-monospace, SF Mono, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = String(orderLabel);
    const tw = Math.max(ctx.measureText(text).width + 4, 10);
    const th = 10;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(lx - tw / 2, ly - th / 2, tw, th, 2.5);
    else ctx.rect(lx - tw / 2, ly - th / 2, tw, th);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, lx, ly + 0.5);
  }

  ctx.restore();
}
