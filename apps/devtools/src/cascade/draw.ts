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

const GHOST_EDGE_ALPHA_LIGHT = 0.28;
const GHOST_EDGE_ALPHA_DARK = 0.22;
/** Muted tree pointers — not cause-tinted. */
const POINTER_LIGHT = "rgba(100, 110, 130, 0.45)";
const POINTER_DARK = "rgba(160, 170, 190, 0.4)";
const POINTER_HOT_LIGHT = "rgba(70, 80, 110, 0.75)";
const POINTER_HOT_DARK = "rgba(200, 210, 230, 0.7)";
/** Order circle sits inside the clip, leading the name. */
const BADGE_R = 7;

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
/** True when both ends are focused (or there is no focus). Used for order badges and edge alpha. */
export function cascadeEdgeInFocus(
  edge: { from: string; to: string },
  focusedIds: ReadonlySet<string> | null | undefined,
): boolean {
  if (!focusedIds) return true;
  return focusedIds.has(edge.from) && focusedIds.has(edge.to);
}

const ARROW_TIP_GAP = 2;

function pointerColor(theme: TimelineTheme, hot: boolean): string {
  if (theme.light) return hot ? POINTER_HOT_LIGHT : POINTER_LIGHT;
  return hot ? POINTER_HOT_DARK : POINTER_DARK;
}

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
  const r = Math.min(6, Math.abs(dy) / 2, Math.abs(busX - x1) / 2, Math.abs(x2 - busX) / 2);
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

function strokeOrthogonal(
  ctx: Canvas2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const mid = (x1 + x2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (Math.abs(y2 - y1) < 1.2) {
    ctx.lineTo(x2, y2);
  } else {
    ctx.lineTo(mid, y1);
    ctx.lineTo(mid, y2);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

function drawEdge(
  ctx: Canvas2D,
  item: CascadeLayoutEdge,
  theme: TimelineTheme,
  alpha = 1,
  lineWidth = 1,
  hot = false,
): void {
  const { from, to, y1, y2, busX } = item;
  const x1 = from.x + from.width;
  const endX = to.x - ARROW_TIP_GAP;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = pointerColor(theme, hot);
  if (busX != null) strokeBus(ctx, x1, y1, busX, y2, endX);
  else strokeOrthogonal(ctx, x1, y1, endX, y2);
  ctx.restore();
}

function drawPortDots(
  _ctx: Canvas2D,
  _layout: CascadeLayout,
  _view: CascadeViewport,
  _world: ReturnType<typeof visibleWorld>,
): void {
  // Pills connect with stubs — no port dots.
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

/** Incoming causal order per node — earliest edge wins when a clip has several parents. */
function incomingOrderById(layout: CascadeLayout): Map<string, number> {
  const orders = new Map<string, number>();
  for (const item of layout.edges) {
    const prev = orders.get(item.edge.to);
    if (prev === undefined || item.edge.order < prev) orders.set(item.edge.to, item.edge.order);
  }
  return orders;
}

function drawClipOrder(
  ctx: Canvas2D,
  cx: number,
  cy: number,
  order: number,
  theme: TimelineTheme,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, BADGE_R, 0, Math.PI * 2);
  // Neutral count chip — not cause-tinted, so it reads as an ordinal, not an icon.
  ctx.fillStyle = theme.light ? hexAlpha(theme.text3, 0.28) : "rgba(120, 130, 160, 0.55)";
  ctx.fill();
  ctx.font = `600 9px ${theme.mono}`;
  ctx.fillStyle = theme.light ? theme.text : "rgba(255,255,255,0.95)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(order), cx, cy + 0.4);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawNode(
  ctx: Canvas2D,
  item: CascadeLayoutNode,
  theme: TimelineTheme,
  view: CascadeViewport,
  options: CascadePaintOptions,
  order: number | null,
): void {
  const { node, rect } = item;
  const color = causeColor(theme, node.cause);
  const afterCursor =
    options.dimAfterCursor !== false &&
    options.cursorTime !== null &&
    node.timestamp > options.cursorTime;
  const unfocused = options.focusedIds != null && !options.focusedIds.has(node.id);
  const alpha = (afterCursor ? 0.3 : 1) * (unfocused ? 0.28 : 1);
  const r = Math.min(10, rect.height / 2);
  ctx.save();
  ctx.globalAlpha = alpha;
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, r);
  if (node.kind === "aggregate") {
    ctx.fillStyle = hexAlpha(theme.panel, theme.light ? 0.92 : 0.96);
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = hexAlpha(color, 0.72);
  } else {
    ctx.fillStyle = hexAlpha(color, theme.light ? 0.16 : 0.18);
    ctx.fill();
    ctx.strokeStyle = hexAlpha(color, theme.light ? 0.55 : 0.48);
  }
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  if (view.zoom >= 0.42) {
    const ink = hexAlpha(color, theme.light ? 0.92 : 0.95);
    const pad = 8;
    const midY = rect.y + rect.height / 2;
    let textX = rect.x + pad;
    if (order != null) {
      const cx = rect.x + pad + BADGE_R;
      drawClipOrder(ctx, cx, midY, order, theme);
      textX = cx + BADGE_R + 5;
    }

    const ms =
      node.kind === "aggregate"
        ? `×${node.aggregateCount.toLocaleString()}`
        : `${node.selfDuration < 10 ? node.selfDuration.toFixed(1) : Math.round(node.selfDuration)}ms`;
    ctx.font = `600 9px ${theme.mono}`;
    const msW = ctx.measureText(ms).width;
    const msX = rect.x + rect.width - pad - msW;
    const nameMax = Math.max(0, msX - 6 - textX);

    ctx.font = `600 10px ${theme.mono}`;
    ctx.fillStyle = ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(ellipsis(ctx, node.name, nameMax), textX, midY + 0.4);

    ctx.font = `500 9px ${theme.mono}`;
    ctx.fillStyle = theme.light ? hexAlpha(color, 0.7) : theme.text3;
    ctx.fillText(ms, msX, midY + 0.4);
    ctx.textBaseline = "alphabetic";
  }
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
  const orders = incomingOrderById(layout);
  for (const edge of layout.edges) {
    if (!edgeVisible(edge, world)) continue;
    const inFocus = cascadeEdgeInFocus(edge.edge, focus);
    drawEdge(ctx, edge, theme, ghost * (inFocus ? 1 : 0.35));
  }
  drawPortDots(ctx, layout, view, world);
  for (const node of layout.nodes) {
    if (!rectVisible(node.rect, world)) continue;
    drawNode(ctx, node, theme, view, options, orders.get(node.node.id) ?? null);
  }
}
function punchClips(ctx: Canvas2D, layout: CascadeLayout, ids: ReadonlySet<string>): void {
  ctx.fillStyle = "#000";
  ctx.globalCompositeOperation = "destination-out";
  for (const id of ids) {
    const item = layout.nodeById.get(id);
    if (!item) continue;
    const r = Math.min(11, item.rect.height / 2 + 1);
    roundedRect(
      ctx,
      item.rect.x - 2,
      item.rect.y - 2,
      item.rect.width + 4,
      item.rect.height + 4,
      r,
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
  const r = Math.min(11, rect.height / 2 + offset);
  roundedRect(
    ctx,
    rect.x - offset,
    rect.y - offset,
    rect.width + offset * 2,
    rect.height + offset * 2,
    r,
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
  const hotRing = theme.light ? POINTER_HOT_LIGHT : theme.accent;
  if (chain && focusId) {
    for (const item of layout.edges) {
      if (!cascadeEdgeOnChain(item.edge, chain)) continue;
      if (!edgeVisible(item, world)) continue;
      drawEdge(ctx, item, theme, 1, 1.5, true);
    }
    for (const id of chain) {
      if (id === options.selectedId || id === options.hoveredId) continue;
      const item = layout.nodeById.get(id);
      if (item) ring(ctx, item.rect, hotRing, 1.5, 1.5);
    }
  }
  if (options.hoveredId && options.hoveredId !== options.selectedId) {
    const item = layout.nodeById.get(options.hoveredId);
    if (item) ring(ctx, item.rect, hotRing, 2, 2);
  }
  if (options.selectedId) {
    const item = layout.nodeById.get(options.selectedId);
    if (item) {
      ctx.save();
      ctx.shadowColor = hexAlpha(theme.accent, 0.56);
      ctx.shadowBlur = 8;
      ring(ctx, item.rect, theme.accent, 2, 2);
      ctx.restore();
    }
  }
}
