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
  /**
   * Expensive / Roots / Cause-Effects: keep the full layout, but paint clips
   * and edges outside this set at low alpha. Do not overlay theme.bg rects —
   * those read as white spots on the grid.
   */
  focusedIds?: ReadonlySet<string> | null;
}
export interface CascadeOverlayOptions {
  selectedId: string | null;
  hoveredId: string | null;
  /** Search hits to keep undimmed. Painted O(hits) via a veil + punched holes. */
  litIds?: ReadonlySet<string> | null;
}

const GHOST_EDGE_ALPHA_LIGHT = 0.14;
const GHOST_EDGE_ALPHA_DARK = 0.09;
/** Prototype neighborhood stroke — saturated blue, not cause-tinted. */
const EDGE_BLUE = "#4c8dff";
const EDGE_BLUE_HOT = "#1d4ed8";

/** Hover previews; a selected clip is the pin once the pointer leaves the graph. */
export function cascadeNeighborhoodId(
  selectedId: string | null,
  hoveredId: string | null,
): string | null {
  return hoveredId ?? selectedId;
}

export function cascadeEdgeIncident(
  edge: { from: string; to: string },
  id: string | null,
): boolean {
  if (id === null) return false;
  return edge.from === id || edge.to === id;
}

export function cascadeNeighborhoodIds(
  edges: readonly { edge: { from: string; to: string } }[],
  id: string | null,
): Set<string> | null {
  if (id === null) return null;
  const ids = new Set<string>([id]);
  for (const item of edges) {
    if (item.edge.from === id) ids.add(item.edge.to);
    if (item.edge.to === id) ids.add(item.edge.from);
  }
  return ids;
}

/** Ancestors of this clip, inclusive — the chain up to the hover/selection. */
export function cascadeChainIds(
  edges: readonly { edge: { from: string; to: string } }[],
  id: string | null,
): Set<string> | null {
  if (id === null) return null;
  const up = new Map<string, string[]>();
  for (const { edge } of edges) {
    const parents = up.get(edge.to);
    if (parents) parents.push(edge.from);
    else up.set(edge.to, [edge.from]);
  }
  const ids = new Set<string>([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    for (const parent of up.get(queue[i]!) ?? []) {
      if (ids.has(parent)) continue;
      ids.add(parent);
      queue.push(parent);
    }
  }
  return ids;
}

export function cascadeEdgeOnChain(
  edge: { from: string; to: string },
  chain: ReadonlySet<string> | null,
): boolean {
  if (chain == null) return false;
  return chain.has(edge.from) && chain.has(edge.to);
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
/** True when both ends are focused (or there is no focus). Used for order badges and edge alpha. */
export function cascadeEdgeInFocus(
  edge: { from: string; to: string },
  focusedIds: ReadonlySet<string> | null | undefined,
): boolean {
  if (!focusedIds) return true;
  return focusedIds.has(edge.from) && focusedIds.has(edge.to);
}

const ARROW_TIP_GAP = 8;

function strokeBus(
  ctx: Canvas2D,
  x1: number,
  y1: number,
  busX: number,
  y2: number,
  x2: number,
): void {
  const dy = y2 - y1;
  const sign = dy < 0 ? -1 : 1;
  const r = Math.min(8, Math.abs(dy) / 2, Math.abs(busX - x1) / 2, Math.abs(x2 - busX) / 2);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (Math.abs(dy) < 1.2 || r < 1) {
    ctx.lineTo(busX, y1);
    ctx.lineTo(busX, y2);
    ctx.lineTo(x2, y2);
  } else {
    ctx.lineTo(busX - r, y1);
    ctx.quadraticCurveTo(busX, y1, busX, y1 + sign * r);
    ctx.lineTo(busX, y2 - sign * r);
    ctx.quadraticCurveTo(busX, y2, busX + r, y2);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

function orderBadgePosition(item: CascadeLayoutEdge, endX: number): { x: number; y: number } {
  const x1 = item.from.x + item.from.width;
  if (item.busX != null) {
    const left = item.busX + 14;
    const right = endX - 14;
    const x = left < right ? (left + right) / 2 : (item.busX + endX) / 2;
    return { x, y: item.y2 - 16 };
  }
  return { x: x1 + (endX - x1) * 0.62, y: item.y2 - 16 };
}

function drawOrderBadge(
  ctx: Canvas2D,
  item: CascadeLayoutEdge,
  theme: TimelineTheme,
  hot: boolean,
  endX: number,
): void {
  const { x, y } = orderBadgePosition(item, endX);
  ctx.font = `600 8.5px ${theme.mono}`;
  const label = String(item.edge.order);
  const width = Math.max(14, ctx.measureText(label).width + 7);
  roundedRect(ctx, x - width / 2, y - 7, width, 14, 7);
  ctx.fillStyle = theme.panel;
  ctx.fill();
  ctx.strokeStyle = hexAlpha(hot ? EDGE_BLUE_HOT : EDGE_BLUE, 0.85);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = theme.text2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 0.25);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawEdge(
  ctx: Canvas2D,
  item: CascadeLayoutEdge,
  theme: TimelineTheme,
  showOrder: boolean,
  alpha = 1,
  lineWidth = 1.25,
  hot = false,
): void {
  const { from, to, y1, y2, c1x, c1y, c2x, c2y, busX } = item;
  const x1 = from.x + from.width;
  const endX = to.x - ARROW_TIP_GAP;
  ctx.save();
  ctx.globalAlpha = alpha;
  const color = hot ? EDGE_BLUE_HOT : hexAlpha(EDGE_BLUE, 0.58);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  if (busX != null) strokeBus(ctx, x1, y1, busX, y2, endX);
  else {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, endX, y2);
    ctx.stroke();
  }
  drawArrowHead(ctx, endX, y2, color);
  if (showOrder) drawOrderBadge(ctx, item, theme, hot, endX);
  ctx.restore();
}

function drawPortDots(
  ctx: Canvas2D,
  layout: CascadeLayout,
  view: CascadeViewport,
  world: ReturnType<typeof visibleWorld>,
): void {
  if (view.zoom < 0.48) return;
  ctx.fillStyle = EDGE_BLUE;
  for (const item of layout.nodes) {
    if (!rectVisible(item.rect, world)) continue;
    const { rect } = item;
    const cy = rect.y + rect.height / 2;
    ctx.beginPath();
    ctx.arc(rect.x + rect.width, cy, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rect.x, cy, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
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
  const unfocused = options.focusedIds != null && !options.focusedIds.has(node.id);
  const alpha = (afterCursor ? 0.3 : 1) * (unfocused ? 0.28 : 1);
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
  const focus = options.focusedIds;
  const ghost = theme.light ? GHOST_EDGE_ALPHA_LIGHT : GHOST_EDGE_ALPHA_DARK;
  for (const edge of layout.edges) {
    if (!edgeVisible(edge, world)) continue;
    const inFocus = cascadeEdgeInFocus(edge.edge, focus);
    drawEdge(ctx, edge, theme, false, ghost * (inFocus ? 1 : 0.35));
  }
  drawPortDots(ctx, layout, view, world);
  for (const node of layout.nodes)
    if (rectVisible(node.rect, world)) drawNode(ctx, node, theme, view, options);
}
function punchClips(ctx: Canvas2D, layout: CascadeLayout, ids: ReadonlySet<string>): void {
  ctx.fillStyle = "#000";
  ctx.globalCompositeOperation = "destination-out";
  for (const id of ids) {
    const item = layout.nodeById.get(id);
    if (!item) continue;
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
  ctx.globalCompositeOperation = "source-over";
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
  const lit = options.litIds;
  const focusId = cascadeNeighborhoodId(options.selectedId, options.hoveredId);
  const chain = cascadeChainIds(layout.edges, focusId);
  if (lit && lit.size > 0) {
    ctx.fillStyle = hexAlpha(theme.bg, 0.66);
    ctx.fillRect(0, 0, view.width, view.height);
    setupWorld(ctx, view);
    punchClips(ctx, layout, lit);
  } else if (chain) {
    ctx.fillStyle = hexAlpha(theme.bg, theme.light ? 0.4 : 0.48);
    ctx.fillRect(0, 0, view.width, view.height);
    setupWorld(ctx, view);
    punchClips(ctx, layout, chain);
  } else {
    setupWorld(ctx, view);
  }
  const world = visibleWorld(view);
  if (chain && focusId) {
    const showOrder = view.zoom >= 0.5;
    for (const item of layout.edges) {
      if (!cascadeEdgeOnChain(item.edge, chain)) continue;
      if (!edgeVisible(item, world)) continue;
      drawEdge(ctx, item, theme, showOrder, 1, 2, true);
    }
    for (const id of chain) {
      if (id === options.selectedId || id === options.hoveredId) continue;
      const item = layout.nodeById.get(id);
      if (item) ring(ctx, item.rect, EDGE_BLUE_HOT, 1.5, 1.5);
    }
  }
  if (options.hoveredId && options.hoveredId !== options.selectedId) {
    const item = layout.nodeById.get(options.hoveredId);
    if (item) ring(ctx, item.rect, EDGE_BLUE_HOT, 2, 2);
  }
  if (options.selectedId) {
    const item = layout.nodeById.get(options.selectedId);
    if (item) {
      ctx.save();
      ctx.shadowColor = hexAlpha(EDGE_BLUE_HOT, 0.56);
      ctx.shadowBlur = 8;
      ring(ctx, item.rect, EDGE_BLUE_HOT, 2, 2);
      ctx.restore();
    }
  }
}
