import type { TimelineTheme } from "../timeline/view/timelineTheme.js";
import { hexAlpha } from "../timeline/view/timelineTheme.js";
import type { CascadeLayout, CascadeLayoutEdge, CascadeLayoutNode, CascadeRect } from "./layout.js";
import type { CascadeCause } from "./model.js";

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CascadeViewport {
  width: number;
  height: number;
  dpr: number;
  zoom: number;
  panX: number;
  panY: number;
}
export interface CascadePaintOptions {
  cursorTime: number | null;
  maxSelfTime: number;
  dimAfterCursor?: boolean;
}
export interface CascadeOverlayOptions {
  selectedId: string | null;
  hoveredId: string | null;
  focusedIds?: ReadonlySet<string> | null;
}

function roundedRect(ctx: Canvas2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
function causeColor(theme: TimelineTheme, cause: CascadeCause): string {
  switch (cause) {
    case "state":
      return theme.state;
    case "props":
      return theme.props;
    case "context":
      return theme.context;
    case "parent":
      return theme.cascade;
    case "mount":
      return theme.accent;
    default:
      return theme.text3;
  }
}
function visibleWorld(view: CascadeViewport) {
  const z = Math.max(0.001, view.zoom);
  return {
    x0: -view.panX / z - 80,
    y0: -view.panY / z - 80,
    x1: (view.width - view.panX) / z + 80,
    y1: (view.height - view.panY) / z + 80,
  };
}
function rectVisible(rect: CascadeRect, world: ReturnType<typeof visibleWorld>): boolean {
  return !(
    rect.x + rect.width < world.x0 ||
    rect.x > world.x1 ||
    rect.y + rect.height < world.y0 ||
    rect.y > world.y1
  );
}
function edgeVisible(edge: CascadeLayoutEdge, world: ReturnType<typeof visibleWorld>): boolean {
  const x0 = Math.min(edge.from.x, edge.to.x);
  const x1 = Math.max(edge.from.x + edge.from.width, edge.to.x + edge.to.width);
  const y0 = Math.min(edge.from.y, edge.to.y) - 60;
  const y1 = Math.max(edge.from.y + edge.from.height, edge.to.y + edge.to.height) + 60;
  return !(x1 < world.x0 || x0 > world.x1 || y1 < world.y0 || y0 > world.y1);
}
function setupScreen(ctx: Canvas2D, view: CascadeViewport): void {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
}
function setupWorld(ctx: Canvas2D, view: CascadeViewport): void {
  const scale = view.dpr * view.zoom;
  ctx.setTransform(scale, 0, 0, scale, view.panX * view.dpr, view.panY * view.dpr);
}
function drawScreenGrid(ctx: Canvas2D, view: CascadeViewport, theme: TimelineTheme): void {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.strokeStyle = hexAlpha(theme.lineStrong, theme.light ? 0.24 : 0.18);
  ctx.lineWidth = 1;
  const step = 64;
  const ox = ((view.panX % step) + step) % step;
  const oy = ((view.panY % step) + step) % step;
  for (let x = ox; x < view.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, view.height);
    ctx.stroke();
  }
  for (let y = oy; y < view.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(view.width, Math.round(y) + 0.5);
    ctx.stroke();
  }
}
function drawArrowHead(ctx: Canvas2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 6, y - 3.5);
  ctx.lineTo(x - 6, y + 3.5);
  ctx.closePath();
  ctx.fill();
}
function drawEdge(
  ctx: Canvas2D,
  item: CascadeLayoutEdge,
  theme: TimelineTheme,
  showOrder: boolean,
): void {
  const { edge, from, to, c1x, c1y, c2x, c2y } = item;
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const color = hexAlpha(causeColor(theme, edge.cause), 0.58);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
  ctx.stroke();
  drawArrowHead(ctx, x2 - 1, y2, color);
  if (!showOrder) return;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 8;
  ctx.font = `600 8.5px ${theme.mono}`;
  const label = String(edge.order);
  const width = Math.max(14, ctx.measureText(label).width + 7);
  roundedRect(ctx, mx - width / 2, my - 7, width, 14, 7);
  ctx.fillStyle = theme.panel;
  ctx.fill();
  ctx.strokeStyle = hexAlpha(theme.accent, 0.72);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = theme.text2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, mx, my + 0.25);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
function ellipsis(ctx: Canvas2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, Math.max(0, lo))}…`;
}
function drawNode(
  ctx: Canvas2D,
  item: CascadeLayoutNode,
  theme: TimelineTheme,
  view: CascadeViewport,
  options: CascadePaintOptions,
): void {
  const { node, rect } = item;
  const color = causeColor(theme, node.cause);
  const afterCursor =
    options.dimAfterCursor !== false &&
    options.cursorTime !== null &&
    node.timestamp > options.cursorTime;
  const alpha = afterCursor ? 0.3 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 6);
  if (node.kind === "aggregate") {
    ctx.fillStyle = hexAlpha(theme.panel, theme.light ? 0.92 : 0.96);
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = hexAlpha(color, 0.72);
  } else {
    ctx.fillStyle = hexAlpha(color, theme.light ? 0.18 : 0.14);
    ctx.fill();
    ctx.strokeStyle = hexAlpha(color, theme.light ? 0.75 : 0.58);
  }
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  roundedRect(ctx, rect.x + 4, rect.y + 5, 3, rect.height - 10, 1.5);
  ctx.fill();
  if (view.zoom >= 0.48) {
    ctx.font = `600 10px ${theme.mono}`;
    ctx.fillStyle = theme.text;
    const suffix = node.kind === "aggregate" ? `  ${node.aggregateCount.toLocaleString()}` : "";
    ctx.fillText(ellipsis(ctx, `${node.name}${suffix}`, rect.width - 22), rect.x + 12, rect.y + 14);
  }
  if (view.zoom >= 0.7) {
    ctx.font = `9px ${theme.mono}`;
    ctx.fillStyle = theme.text3;
    const cause = node.cause === "parent" ? "cascade" : node.cause;
    const meta =
      node.kind === "aggregate" ? cause : `${cause} · ${node.selfDuration.toFixed(1)}ms self`;
    ctx.fillText(ellipsis(ctx, meta, rect.width - 22), rect.x + 12, rect.y + 27);
  }
  const ratio = Math.max(0, Math.min(1, node.selfDuration / Math.max(0.001, options.maxSelfTime)));
  ctx.fillStyle = hexAlpha(color, 0.85);
  ctx.fillRect(rect.x + 1, rect.y + rect.height - 2, Math.max(1, (rect.width - 2) * ratio), 1.5);
  ctx.restore();
}
export function drawCascadeBase(
  ctx: Canvas2D,
  layout: CascadeLayout,
  view: CascadeViewport,
  theme: TimelineTheme,
  options: CascadePaintOptions,
): void {
  setupScreen(ctx, view);
  drawScreenGrid(ctx, view, theme);
  setupWorld(ctx, view);
  const world = visibleWorld(view);
  const showOrder = view.zoom >= 0.66 && layout.edges.length <= 300;
  for (const edge of layout.edges)
    if (edgeVisible(edge, world)) drawEdge(ctx, edge, theme, showOrder);
  for (const node of layout.nodes)
    if (rectVisible(node.rect, world)) drawNode(ctx, node, theme, view, options);
}
function ring(
  ctx: Canvas2D,
  rect: CascadeRect,
  color: string,
  width: number,
  offset: number,
): void {
  roundedRect(
    ctx,
    rect.x - offset,
    rect.y - offset,
    rect.width + offset * 2,
    rect.height + offset * 2,
    7,
  );
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}
export function drawCascadeOverlay(
  ctx: Canvas2D,
  layout: CascadeLayout,
  view: CascadeViewport,
  theme: TimelineTheme,
  options: CascadeOverlayOptions,
): void {
  setupScreen(ctx, view);
  setupWorld(ctx, view);
  if (options.focusedIds) {
    for (const item of layout.nodes) {
      if (options.focusedIds.has(item.node.id)) continue;
      ctx.fillStyle = hexAlpha(theme.bg, 0.66);
      roundedRect(
        ctx,
        item.rect.x - 2,
        item.rect.y - 2,
        item.rect.width + 4,
        item.rect.height + 4,
        7,
      );
      ctx.fill();
    }
  }
  if (options.hoveredId && options.hoveredId !== options.selectedId) {
    const item = layout.nodeById.get(options.hoveredId);
    if (item) ring(ctx, item.rect, hexAlpha(theme.text, 0.72), 1, 1.5);
  }
  if (options.selectedId) {
    const item = layout.nodeById.get(options.selectedId);
    if (item) {
      ctx.save();
      ctx.shadowColor = hexAlpha(theme.accent, 0.56);
      ctx.shadowBlur = 8;
      ring(ctx, item.rect, hexAlpha(theme.accent, 0.42), 4, 3);
      ctx.shadowBlur = 0;
      ring(ctx, item.rect, theme.accent, 2, 2);
      ring(ctx, item.rect, hexAlpha(theme.text, 0.9), 1, 0.5);
      ctx.restore();
    }
  }
}
