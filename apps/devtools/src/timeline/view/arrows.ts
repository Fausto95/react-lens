/**
 * Causal arrow geometry — tldraw-style cubic arcs with tangent-aligned heads.
 */

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
    x:
      3 * u * u * (p1.x - p0.x) +
      6 * u * t * (p2.x - p1.x) +
      3 * t * t * (p3.x - p2.x),
    y:
      3 * u * u * (p1.y - p0.y) +
      6 * u * t * (p2.y - p1.y) +
      3 * t * t * (p3.y - p2.y),
  };
}

/** Horizontal arc controls — same family tldraw uses for cross-shape arrows. */
export function causalBezierPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): [Point, Point, Point, Point] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const handle = Math.min(120, Math.max(28, Math.abs(dx) * 0.45 + Math.abs(dy) * 0.12));
  const sign = dx >= 0 ? 1 : -1;
  const p0: Point = { x: x1, y: y1 };
  const p3: Point = { x: x2, y: y2 };
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

export interface DrawCausalArrowArgs {
  ctx: CanvasRenderingContext2D;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  lineWidth?: number;
  headSize?: number;
}

/**
 * Stroke a cubic causal arrow and place a filled head aligned to the curve tangent.
 */
export function drawCausalArrow(args: DrawCausalArrowArgs): void {
  const { ctx, x1, y1, x2, y2, color, lineWidth = 1.35, headSize = 7 } = args;
  const [p0, p1, p2, p3] = causalBezierPoints(x1, y1, x2, y2);

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
  ctx.restore();
}
