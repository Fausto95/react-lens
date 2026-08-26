/**
 * Causal pointer geometry — orthogonal tree stubs with circular order badges.
 *
 * Routing:
 * - Stacked parent→child: left-edge family bus (vertical stem + horizontal stub)
 * - Fan-out: shared left bus, one stub per child
 * - Forward in time: exit right of source → enter left of target (orthogonal)
 * - Order badge: muted circle on the child attachment
 */

import type { ClipCauseColor } from "../model/lanes.js";

export type ArrowSide = "left" | "forward";

export interface ClipPorts {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Padding for span culling — orthogonal stubs stay near the clip edges. */
const SPAN_PAD_PX = 24;

/**
 * Whether a pointer can intersect the stage. Tests the span between both ports
 * padded slightly — endpoint containment is wrong: a pointer with one port
 * off-screen still crosses the viewport.
 */
export function arrowSpanVisible(
  from: ClipPorts,
  to: ClipPorts,
  nameW: number,
  stageW: number,
  pad = SPAN_PAD_PX,
): boolean {
  const lo = Math.min(from.x0, to.x0) - pad;
  const hi = Math.max(from.x1, to.x1) + pad;
  return hi >= nameW && lo <= stageW;
}

export interface ArrowRoute {
  side: ArrowSide;
  /** Parent attachment x (left bus or right exit). */
  x1: number;
  y1: number;
  /** Child left attachment. */
  x2: number;
  y2: number;
  /**
   * Shared vertical bus x for left-side family stubs. Null for forward links.
   */
  busX: number | null;
}

/**
 * Pick attachment: stacked children share a left bus; later-in-time targets
 * connect forward from the parent's right edge.
 */
export function routeCausalArrow(
  from: ClipPorts,
  to: ClipPorts,
  slot = 1,
  slotCount = 1,
): ArrowRoute {
  const y1 = (from.y0 + from.y1) / 2;
  const y2 = (to.y0 + to.y1) / 2;
  const overlapX = Math.min(from.x1, to.x1) - Math.max(from.x0, to.x0);
  const minW = Math.min(from.x1 - from.x0, to.x1 - to.x0, 1);
  const stacked = overlapX > minW * 0.3 || to.x0 < from.x1 - 4;
  const dyMid = y2 - y1;

  if (stacked && Math.abs(dyMid) > 8) {
    // Left family bus — fan slots share the same stem; y1 stays parent mid.
    void slot;
    void slotCount;
    const busX = from.x0;
    return {
      side: "left",
      x1: busX,
      y1,
      x2: to.x0,
      y2,
      busX,
    };
  }

  return {
    side: "forward",
    x1: from.x1,
    y1,
    x2: to.x0,
    y2,
    busX: null,
  };
}

export interface DrawCausalArrowArgs {
  ctx: CanvasRenderingContext2D;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke color (muted gray). */
  color: string;
  side?: ArrowSide;
  busX?: number | null;
  lineWidth?: number;
  /** 1-based ordinal for causal sequence (always drawn, including lone arrows). */
  orderLabel?: number;
  /** Circle + number fill for the Datadog-style badge. */
  badgeFill?: string;
  badgeText?: string;
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

const BADGE_R = 6;

function strokeOrthogonal(
  ctx: CanvasRenderingContext2D,
  side: ArrowSide,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  busX: number | null,
): void {
  ctx.beginPath();
  if (side === "left" && busX != null) {
    ctx.moveTo(busX, y1);
    ctx.lineTo(busX, y2);
    ctx.lineTo(x2, y2);
  } else {
    const mid = (x1 + x2) / 2;
    ctx.moveTo(x1, y1);
    if (Math.abs(y2 - y1) < 1.2) {
      ctx.lineTo(x2, y2);
    } else {
      ctx.lineTo(mid, y1);
      ctx.lineTo(mid, y2);
      ctx.lineTo(x2, y2);
    }
  }
  ctx.stroke();
}

/**
 * Stroke an orthogonal causal pointer. Order lives on the child clip, not the stub.
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
    busX = null,
    lineWidth = 1,
    orderLabel,
  } = args;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = orderLabel != null && orderLabel > 6 ? 0.55 : 1;
  strokeOrthogonal(ctx, side, x1, y1, x2, y2, busX);
  ctx.restore();
}

/** Draw the causal order circle inside the leading edge of a child clip. */
export function drawClipOrderBadge(
  ctx: CanvasRenderingContext2D,
  clipLeft: number,
  clipMidY: number,
  order: number,
  fill: string,
  text: string,
): void {
  const cx = clipLeft + 8 + BADGE_R;
  ctx.beginPath();
  ctx.arc(cx, clipMidY, BADGE_R, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.font = `600 8px ui-monospace, SF Mono, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = text;
  ctx.fillText(String(order), cx, clipMidY + 0.4);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
