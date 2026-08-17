/* oxlint-disable react/react-compiler -- imperative canvas/gesture refs; pointer hot paths intentionally bypass React state */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { ComponentId } from "@reactlens/protocol";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronLeft,
  IconChevronRight,
  IconCollapse,
  IconLive,
  IconSearch,
} from "@reactlens/icons";
import { typeLaneKey } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import type { Timeline as TimelineModel } from "./useTimeline.js";
import { readTimelineTheme, type TimelineTheme } from "../timeline/view/timelineTheme.js";
import { drawCascadeBase, drawCascadeOverlay, type CascadeViewport } from "./draw.js";
import { layoutCascade, type CascadeLayout, type CascadeLayoutNode } from "./layout.js";
import {
  aggregateExpansionKey,
  buildCascadeProjection,
  type CascadeAggregateNode,
  type CascadeProjection,
} from "./model.js";
import { createCascadeRenderer, type CascadeRendererClient } from "./rendererClient.js";
import { buildCascadeSearchIndex, queryCascadeSearchIndex } from "./search.js";
import { CascadeSpatialIndex } from "./spatial.js";
import { InteractionList } from "./InteractionList.js";
import "./cascade.css";
import "./transport.css";

interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

interface MinimapTransform {
  x: number;
  y: number;
  scale: number;
}

type FocusMode = "all" | "expensive" | "roots" | "custom";

export interface CascadeProps {
  store: TraceStore;
  model: TimelineModel;
  cursor: TimeCursor;
  onCursor: (cursor: TimeCursor) => void;
  onSelectComponent?: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  transport?: React.ReactNode;
}

const MINIMAP_SIZE = 148;
const MINIMAP_PAD = 8;

function containingInteraction(
  interactions: TimelineModel["interactions"],
  time: number,
): TimelineModel["interactions"][number] | null {
  if (interactions.length === 0) return null;
  let lo = 0;
  let hi = interactions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (interactions[mid]!.start <= time) lo = mid + 1;
    else hi = mid;
  }
  const candidate = interactions[Math.max(0, lo - 1)] ?? interactions[0]!;
  return candidate;
}

function interactionWindow<T extends { id: string }>(
  items: readonly T[],
  selectedId: string | null,
): T[] {
  const max = 180;
  if (items.length <= max) return [...items];
  const selected =
    selectedId === null ? items.length - 1 : items.findIndex((item) => item.id === selectedId);
  const center = selected < 0 ? items.length - 1 : selected;
  const start = Math.max(0, Math.min(items.length - max, center - Math.floor(max / 2)));
  return items.slice(start, start + max);
}

function projectionKey(
  interaction: TimelineModel["interactions"][number],
  expanded: ReadonlySet<string>,
): string {
  const last = interaction.renderIds[interaction.renderIds.length - 1];
  return `${interaction.id}:${interaction.renderIds.length}:${last ?? "none"}:${[...expanded].sort().join(",")}`;
}

function reachable(
  projection: CascadeProjection,
  startId: string,
  direction: "upstream" | "downstream",
): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of projection.edges) {
    const from = direction === "downstream" ? edge.from : edge.to;
    const to = direction === "downstream" ? edge.to : edge.from;
    const list = next.get(from);
    if (list) list.push(to);
    else next.set(from, [to]);
  }
  const seen = new Set<string>([startId]);
  const queue = [startId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const child of next.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return seen;
}

function fitTransform(layout: CascadeLayout, width: number, height: number): ViewTransform {
  if (width <= 0 || height <= 0) return { zoom: 1, panX: 0, panY: 0 };
  const pad = 34;
  const zoom = Math.max(
    0.18,
    Math.min(
      1.35,
      (width - pad * 2) / Math.max(1, layout.worldWidth),
      (height - pad * 2) / Math.max(1, layout.worldHeight),
    ),
  );
  return {
    zoom,
    panX: (width - layout.worldWidth * zoom) / 2,
    panY: (height - layout.worldHeight * zoom) / 2,
  };
}

function initialTransform(layout: CascadeLayout, width: number, height: number): ViewTransform {
  const inset = 28;
  return {
    zoom: 1,
    panX: layout.worldWidth <= width ? (width - layout.worldWidth) / 2 : inset,
    panY: layout.worldHeight <= height ? (height - layout.worldHeight) / 2 : inset,
  };
}

function minimapTransform(layout: CascadeLayout, width: number, height: number): MinimapTransform {
  const usableW = Math.max(1, width - MINIMAP_PAD * 2);
  const usableH = Math.max(1, height - MINIMAP_PAD * 2);
  const scale = Math.min(
    usableW / Math.max(1, layout.worldWidth),
    usableH / Math.max(1, layout.worldHeight),
  );
  return {
    scale,
    x: (width - layout.worldWidth * scale) / 2,
    y: (height - layout.worldHeight * scale) / 2,
  };
}

function centerOnRect(
  view: ViewTransform,
  size: { width: number; height: number },
  rect: { x: number; y: number; width: number; height: number },
): void {
  const z = Math.max(0.001, view.zoom);
  view.panX = size.width / 2 - (rect.x + rect.width / 2) * z;
  view.panY = size.height / 2 - (rect.y + rect.height / 2) * z;
}

function miniNodeColor(
  theme: TimelineTheme,
  cause: CascadeProjection["nodes"][number]["cause"],
): string {
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

function buildMinimapCache(
  layout: CascadeLayout,
  theme: TimelineTheme,
  width: number,
  height: number,
  dpr: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.panel;
  ctx.fillRect(0, 0, width, height);
  const mini = minimapTransform(layout, width, height);
  for (const item of layout.nodes) {
    const rect = item.rect;
    ctx.fillStyle = miniNodeColor(theme, item.node.cause);
    ctx.globalAlpha = item.node.kind === "aggregate" ? 0.9 : 0.66;
    ctx.fillRect(
      mini.x + rect.x * mini.scale,
      mini.y + rect.y * mini.scale,
      Math.max(1.5, rect.width * mini.scale),
      Math.max(1.5, rect.height * mini.scale),
    );
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function Island({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rl-cascade-island${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

function Tool({
  title,
  active,
  disabled,
  className,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rl-cascade-tool${active ? " active" : ""}${className ? ` ${className}` : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Cascade({
  store,
  model,
  cursor,
  onCursor,
  onSelectComponent,
  onHighlight,
  transport,
}: CascadeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapCacheRef = useRef<HTMLCanvasElement | null>(null);
  const minimapDragRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipNameRef = useRef<HTMLElement>(null);
  const tooltipMetaRef = useRef<HTMLElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<CascadeRendererClient | null>(null);
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const viewRef = useRef<ViewTransform>({ zoom: 1, panX: 0, panY: 0 });
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<null | {
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
    hitId: string | null;
    moved: boolean;
  }>(null);
  const resetViewRef = useRef(true);

  const latest = model.interactions[model.interactions.length - 1] ?? null;
  const initial = containingInteraction(model.interactions, cursor.t) ?? latest;
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(
    initial?.id ?? null,
  );
  const [followLatest, setFollowLatest] = useState(initial?.id === latest?.id);
  const [expandedAggregates, setExpandedAggregates] = useState<ReadonlySet<string>>(new Set());
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>("all");
  const [customFocus, setCustomFocus] = useState<ReadonlySet<string> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHitId, setSearchHitId] = useState<string | null>(null);

  useEffect(() => {
    if (!followLatest || !latest || selectedInteractionId === latest.id) return;
    setSelectedInteractionId(latest.id);
    setExpandedAggregates(new Set());
    resetViewRef.current = true;
  }, [followLatest, latest, selectedInteractionId]);

  useEffect(() => {
    const renderId = model.state.selectedRender;
    if (renderId === null) return;
    const render = store.getRender(renderId);
    if (!render) return;
    const nextInteraction = containingInteraction(model.interactions, render.timestamp);
    if (nextInteraction && nextInteraction.id !== selectedInteractionId) {
      setSelectedInteractionId(nextInteraction.id);
      setFollowLatest(nextInteraction.id === latest?.id);
      resetViewRef.current = true;
    }
    setLocalSelectedId(null);
  }, [latest?.id, model.interactions, model.state.selectedRender, selectedInteractionId, store]);

  const interaction =
    model.interactions.find((item) => item.id === selectedInteractionId) ?? latest ?? null;
  const projectionCache = useRef<{ key: string; projection: CascadeProjection | null }>({
    key: "",
    projection: null,
  });
  let projection: CascadeProjection | null = null;
  if (interaction) {
    const key = projectionKey(interaction, expandedAggregates);
    if (projectionCache.current.key !== key) {
      projectionCache.current = {
        key,
        projection: buildCascadeProjection(store, interaction, {
          aggregateThreshold: 6,
          maxVisibleNodes: 1_200,
          expandedAggregateKeys: expandedAggregates,
        }),
      };
    }
    projection = projectionCache.current.projection;
  } else {
    projectionCache.current = { key: "", projection: null };
  }

  const searchIndex = useMemo(
    () => (projection ? buildCascadeSearchIndex(projection.nodes) : null),
    [projection],
  );
  const maxSelfTime = useMemo(
    () => Math.max(0.001, ...(projection?.nodes.map((node) => node.selfDuration) ?? [1])),
    [projection],
  );
  const layout = useMemo(() => (projection ? layoutCascade(projection) : null), [projection]);
  const spatial = useMemo(() => (layout ? new CascadeSpatialIndex(layout.nodes) : null), [layout]);
  const selectedId =
    localSelectedId ??
    (model.state.selectedRender === null ? null : `r:${model.state.selectedRender as number}`);
  const matches = useMemo(
    () => (searchIndex ? queryCascadeSearchIndex(searchIndex, searchQuery) : []),
    [searchIndex, searchQuery],
  );
  const searching = searchQuery.trim().length > 0;
  const searchHitIndex = matches.findIndex((node) => node.id === searchHitId);
  const searchCount = !searching
    ? ""
    : matches.length === 0
      ? "0"
      : `${(searchHitIndex < 0 ? 0 : searchHitIndex) + 1}/${matches.length}`;

  const focusedIds = useMemo(() => {
    if (!projection) return null;
    if (searching) return matches.length > 0 ? new Set(matches.map((node) => node.id)) : null;
    if (focusMode === "custom") return customFocus;
    if (focusMode === "roots") {
      const stateRoots = projection.nodes
        .filter((node) => node.depth === 0 && (node.cause === "state" || node.cause === "mount"))
        .map((node) => node.id);
      return new Set(stateRoots.length > 0 ? stateRoots : projection.roots);
    }
    if (focusMode === "expensive") {
      const threshold = maxSelfTime * 0.35;
      return new Set(
        projection.nodes
          .filter((node) => node.selfDuration >= threshold || node.depth === 0)
          .map((node) => node.id),
      );
    }
    return null;
  }, [customFocus, focusMode, matches, maxSelfTime, projection, searching]);

  const themeRef = useRef<TimelineTheme>(readTimelineTheme(null));
  const currentViewport = useCallback(
    (): CascadeViewport => ({ ...sizeRef.current, ...viewRef.current }),
    [],
  );

  const paintMinimap = useCallback(() => {
    const canvas = minimapRef.current;
    const cache = minimapCacheRef.current;
    if (!canvas || !cache || !layout) return;
    const dpr = sizeRef.current.dpr;
    const width = canvas.clientWidth || MINIMAP_SIZE;
    const height = canvas.clientHeight || MINIMAP_SIZE;
    const targetW = Math.max(1, Math.round(width * dpr));
    const targetH = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(cache, 0, 0, cache.width, cache.height, 0, 0, width, height);
    const mini = minimapTransform(layout, width, height);
    const view = viewRef.current;
    const stage = sizeRef.current;
    const worldX = -view.panX / view.zoom;
    const worldY = -view.panY / view.zoom;
    const worldW = stage.width / view.zoom;
    const worldH = stage.height / view.zoom;
    ctx.fillStyle = "rgba(96,165,250,.08)";
    ctx.strokeStyle = themeRef.current.accent;
    ctx.lineWidth = 1;
    ctx.fillRect(
      mini.x + worldX * mini.scale,
      mini.y + worldY * mini.scale,
      worldW * mini.scale,
      worldH * mini.scale,
    );
    ctx.strokeRect(
      mini.x + worldX * mini.scale + 0.5,
      mini.y + worldY * mini.scale + 0.5,
      worldW * mini.scale,
      worldH * mini.scale,
    );
  }, [layout]);

  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCascadeOverlay(ctx, layout, currentViewport(), themeRef.current, {
      selectedId,
      hoveredId: hoverRef.current,
      litIds: searching ? focusedIds : null,
    });
  }, [currentViewport, focusedIds, layout, searching, selectedId]);

  const paintBase = useCallback(() => {
    if (!layout) return;
    const viewport = currentViewport();
    const cursorTime = cursor.mode === "live" ? null : cursor.t;
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.paint(viewport, cursorTime, searching ? null : focusedIds);
      return;
    }
    const canvas = baseRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    drawCascadeBase(ctx, layout, viewport, themeRef.current, {
      cursorTime,
      maxSelfTime,
      dimAfterCursor: true,
      focusedIds: searching ? null : focusedIds,
    });
  }, [currentViewport, cursor.mode, cursor.t, focusedIds, layout, maxSelfTime, searching]);

  const paintAll = useCallback(() => {
    paintBase();
    paintOverlay();
    paintMinimap();
    if (zoomRef.current) zoomRef.current.textContent = `${Math.round(viewRef.current.zoom * 100)}%`;
  }, [paintBase, paintMinimap, paintOverlay]);

  const fit = useCallback(() => {
    if (!layout) return;
    const size = sizeRef.current;
    viewRef.current = fitTransform(layout, size.width, size.height);
    paintAll();
  }, [layout, paintAll]);

  const resetTo100 = useCallback(() => {
    if (!layout) return;
    const size = sizeRef.current;
    viewRef.current = initialTransform(layout, size.width, size.height);
    resetViewRef.current = false;
    paintAll();
  }, [layout, paintAll]);

  const revealMatch = useCallback(
    (id: string) => {
      setSearchHitId(id);
      setLocalSelectedId(id);
      const item = layout?.nodeById.get(id);
      if (item) {
        centerOnRect(viewRef.current, sizeRef.current, item.rect);
        paintAll();
      }
    },
    [layout, paintAll],
  );

  const stepSearch = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      const current = matches.findIndex((node) => node.id === searchHitId);
      const start = current < 0 ? 0 : current;
      const next = matches[(start + delta + matches.length) % matches.length];
      if (next) revealMatch(next.id);
    },
    [matches, revealMatch, searchHitId],
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchHitId(null);
    setLocalSelectedId(null);
  }, []);

  const focusSearch = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    if (!searching) return;
    if (matches.length === 0) {
      if (searchHitId !== null) setSearchHitId(null);
      return;
    }
    if (searchHitId && matches.some((node) => node.id === searchHitId)) return;
    const first = matches[0];
    if (first) revealMatch(first.id);
  }, [matches, revealMatch, searchHitId, searching]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (!rect) return;
      const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
      sizeRef.current = { width: Math.max(1, rect.width), height: Math.max(1, rect.height), dpr };
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.width = Math.max(1, Math.round(rect.width * dpr));
        overlay.height = Math.max(1, Math.round(rect.height * dpr));
      }
      const base = baseRef.current;
      if (base && !rendererRef.current) {
        base.width = Math.max(1, Math.round(rect.width * dpr));
        base.height = Math.max(1, Math.round(rect.height * dpr));
      }
      rendererRef.current?.resize(rect.width, rect.height, dpr);
      if (resetViewRef.current && layout) {
        viewRef.current = initialTransform(layout, rect.width, rect.height);
        resetViewRef.current = false;
      }
      paintAll();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [layout, paintAll]);

  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    rendererRef.current = createCascadeRenderer(canvas);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      themeRef.current = readTimelineTheme(rootRef.current?.closest(".rl-redesign") ?? null);
      if (layout) rendererRef.current?.setFrame(layout, themeRef.current, maxSelfTime);
      if (layout) {
        const mini = minimapRef.current;
        const width = mini?.clientWidth || MINIMAP_SIZE;
        const height = mini?.clientHeight || MINIMAP_SIZE;
        minimapCacheRef.current = buildMinimapCache(
          layout,
          themeRef.current,
          width,
          height,
          sizeRef.current.dpr,
        );
        if (resetViewRef.current && sizeRef.current.width > 1 && sizeRef.current.height > 1) {
          viewRef.current = initialTransform(layout, sizeRef.current.width, sizeRef.current.height);
          resetViewRef.current = false;
        }
      } else {
        minimapCacheRef.current = null;
      }
      paintAll();
    };
    applyTheme();
    const root = document.documentElement;
    const observer = new MutationObserver(applyTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-rl-theme"] });
    return () => observer.disconnect();
  }, [layout, maxSelfTime, paintAll]);

  useEffect(() => paintAll(), [cursor.mode, cursor.t, focusMode, customFocus, paintAll]);

  const setStageCursor = useCallback((panning: boolean, overNode: boolean) => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.classList.toggle("dragging", panning);
    stage.classList.toggle("over-node", !panning && overNode);
  }, []);

  const worldPoint = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0, sx: 0, sy: 0 };
    const rect = stage.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const view = viewRef.current;
    return { sx, sy, x: (sx - view.panX) / view.zoom, y: (sy - view.panY) / view.zoom };
  }, []);

  const recenterFromMinimap = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = minimapRef.current;
      if (!canvas || !layout) return;
      const rect = canvas.getBoundingClientRect();
      const mini = minimapTransform(layout, rect.width, rect.height);
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const wx = (mx - mini.x) / Math.max(0.0001, mini.scale);
      const wy = (my - mini.y) / Math.max(0.0001, mini.scale);
      const view = viewRef.current;
      view.panX = sizeRef.current.width / 2 - wx * view.zoom;
      view.panY = sizeRef.current.height / 2 - wy * view.zoom;
      paintAll();
    },
    [layout, paintAll],
  );

  const updateTooltip = useCallback((hit: CascadeLayoutNode | null, sx: number, sy: number) => {
    const tip = tooltipRef.current;
    if (!tip) return;
    if (!hit) {
      tip.style.display = "none";
      return;
    }
    if (tooltipNameRef.current) tooltipNameRef.current.textContent = hit.node.name;
    if (tooltipMetaRef.current) {
      const count =
        hit.node.kind === "aggregate" ? `${hit.node.aggregateCount} renders` : hit.node.cause;
      tooltipMetaRef.current.textContent = `${count} · ${hit.node.selfDuration.toFixed(2)}ms self`;
    }
    const width = stageRef.current?.clientWidth ?? 300;
    const height = stageRef.current?.clientHeight ?? 200;
    tip.style.left = `${Math.min(width - 220, Math.max(8, sx + 12))}px`;
    tip.style.top = `${Math.min(height - 70, Math.max(8, sy + 12))}px`;
    tip.style.display = "block";
  }, []);

  const setHover = useCallback(
    (hit: CascadeLayoutNode | null, sx: number, sy: number) => {
      const next = hit?.node.id ?? null;
      if (next !== hoverRef.current) {
        hoverRef.current = next;
        onHighlight?.(hit?.node.componentId ?? null);
        paintOverlay();
      }
      updateTooltip(hit, sx, sy);
    },
    [onHighlight, paintOverlay, updateTooltip],
  );

  const selectNode = useCallback(
    (item: CascadeLayoutNode) => {
      const node = item.node;
      if (node.kind === "aggregate") {
        setLocalSelectedId(node.id);
        const key = aggregateExpansionKey(node as CascadeAggregateNode);
        if (key) {
          setExpandedAggregates((previous) => {
            const next = new Set(previous);
            next.add(key);
            return next;
          });
        }
        return;
      }
      setLocalSelectedId(null);
      model.dispatch({
        type: "selectClip",
        renderId: node.renderId,
        laneKey: typeLaneKey(node.name),
      });
      onSelectComponent?.(node.componentId);
    },
    [model, onSelectComponent],
  );

  const focusDirection = useCallback(
    (direction: "upstream" | "downstream") => {
      if (!projection || !selectedId) return;
      setCustomFocus(reachable(projection, selectedId, direction));
      setFocusMode("custom");
    },
    [projection, selectedId],
  );

  const collapseGroups = useCallback(() => {
    setExpandedAggregates((previous) => (previous.size === 0 ? previous : new Set()));
    setLocalSelectedId(null);
    resetViewRef.current = true;
  }, []);

  const chooseInteraction = useCallback(
    (id: string) => {
      const next = model.interactions.find((item) => item.id === id);
      if (!next) return;
      // A selected render belongs to the previous interaction. Clear it first so
      // the selected-render synchronization effect cannot immediately navigate
      // Cascade back to that interaction after this explicit user choice.
      model.dispatch({ type: "clearClip" });
      setSelectedInteractionId(id);
      setFollowLatest(id === latest?.id);
      setExpandedAggregates(new Set());
      setLocalSelectedId(null);
      setFocusMode("all");
      setCustomFocus(null);
      resetViewRef.current = true;
      onCursor({ mode: "historical", t: next.start });
    },
    [latest?.id, model, onCursor],
  );

  const stepInteraction = useCallback(
    (delta: number) => {
      if (!interaction || model.interactions.length === 0) return;
      const index = model.interactions.findIndex((item) => item.id === interaction.id);
      const next =
        model.interactions[Math.max(0, Math.min(model.interactions.length - 1, index + delta))];
      if (next) chooseInteraction(next.id);
    },
    [chooseInteraction, interaction, model.interactions],
  );

  const interactions = interactionWindow(model.interactions, selectedInteractionId);
  const footer = projection
    ? `${projection.totalRenderCount.toLocaleString()} renders · ${projection.totalSelfTime.toFixed(1)}ms self · depth ${projection.maxDepth}${projection.aggregatedRenderCount ? ` · ${projection.aggregatedRenderCount.toLocaleString()} aggregated` : ""}`
    : "No interaction data";

  return (
    <div
      className="rl-cascade"
      ref={rootRef}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          focusSearch();
        }
      }}
    >
      <div className="rl-cascade-toolbar">
        <Island label="Interactions">
          <Tool title="Previous interaction" onClick={() => stepInteraction(-1)}>
            <IconChevronLeft size={14} />
          </Tool>
          <Tool title="Next interaction" onClick={() => stepInteraction(1)}>
            <IconChevronRight size={14} />
          </Tool>
        </Island>
        <span className="rl-cascade-sep" aria-hidden="true" />
        <Island label="Viewport">
          <Tool className="rl-cascade-tool-text" title="Fit the entire cascade" onClick={fit}>
            Fit
          </Tool>
          <Tool className="rl-cascade-tool-text" title="Reset zoom to 100%" onClick={resetTo100}>
            1:1
          </Tool>
          <span className="rl-cascade-zoom" ref={zoomRef}>
            100%
          </span>
        </Island>
        <span className="rl-cascade-sep rl-cascade-sep-kind" aria-hidden="true" />
        <span className="rl-cascade-pill">{interaction?.label ?? "idle"}</span>
        {expandedAggregates.size > 0 ? (
          <Tool title="Collapse all expanded render groups (C)" onClick={collapseGroups}>
            <IconCollapse size={14} />
          </Tool>
        ) : null}
        <span className="spacer" />
        <div className="rl-cascade-trailing">
          <Island className="rl-cascade-seg" label="Focus">
            <Tool
              className="rl-cascade-tool-text"
              title="All renders"
              active={focusMode === "all"}
              onClick={() => {
                setFocusMode("all");
                setCustomFocus(null);
              }}
            >
              All
            </Tool>
            <Tool
              className="rl-cascade-tool-text rl-cascade-tool-expensive"
              title="Expensive renders"
              active={focusMode === "expensive"}
              onClick={() => setFocusMode("expensive")}
            >
              Expensive
            </Tool>
            <Tool
              className="rl-cascade-tool-text rl-cascade-tool-roots"
              title="Interaction roots"
              active={focusMode === "roots"}
              onClick={() => setFocusMode("roots")}
            >
              Roots
            </Tool>
          </Island>
          <Island className="rl-cascade-cause" label="Cause and effects">
            <Tool
              className="rl-cascade-tool-text"
              title="Focus cause"
              disabled={!selectedId}
              onClick={() => focusDirection("upstream")}
            >
              <IconArrowUp size={12} />
              <span className="rl-cascade-tool-label">Cause</span>
            </Tool>
            <Tool
              className="rl-cascade-tool-text"
              title="Focus effects"
              disabled={!selectedId}
              onClick={() => focusDirection("downstream")}
            >
              <IconArrowDown size={12} />
              <span className="rl-cascade-tool-label">Effects</span>
            </Tool>
          </Island>
          {transport}
          <button
            type="button"
            className={`rl-cascade-latest${followLatest ? " active" : ""}`}
            title="Follow the latest interaction"
            aria-label="Follow the latest interaction"
            aria-pressed={followLatest}
            onClick={() => {
              setFollowLatest(true);
              if (latest) chooseInteraction(latest.id);
            }}
          >
            <IconLive size={12} />
            <span className="rl-cascade-latest-label">Latest</span>
          </button>
        </div>
      </div>

      <div className="rl-cascade-body">
        <InteractionList
          store={store}
          interactions={interactions}
          totalCount={model.interactions.length}
          selectedId={interaction?.id ?? null}
          t0={model.bounds.t0}
          onSelect={chooseInteraction}
        />

        <div
          className="rl-cascade-stage"
          ref={stageRef}
          tabIndex={0}
          role="application"
          aria-label="Render cascade graph"
          onPointerDown={(event) => {
            const point = worldPoint(event.clientX, event.clientY);
            const hit = spatial?.hit(point.x, point.y) ?? null;
            dragRef.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              panX: viewRef.current.panX,
              panY: viewRef.current.panY,
              hitId: hit?.node.id ?? null,
              moved: false,
            };
            setStageCursor(false, hit != null);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (drag) {
              const dx = event.clientX - drag.x;
              const dy = event.clientY - drag.y;
              if (!drag.moved && Math.hypot(dx, dy) > 3) {
                drag.moved = true;
                setStageCursor(true, false);
              }
              if (drag.moved) {
                viewRef.current.panX = drag.panX + dx;
                viewRef.current.panY = drag.panY + dy;
                paintAll();
              }
              return;
            }
            const point = worldPoint(event.clientX, event.clientY);
            const hit = spatial?.hit(point.x, point.y) ?? null;
            setStageCursor(false, hit != null);
            setHover(hit, point.sx, point.sy);
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            dragRef.current = null;
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {}
            const point = worldPoint(event.clientX, event.clientY);
            setStageCursor(false, spatial?.hit(point.x, point.y) != null);
            if (!drag || drag.moved || !drag.hitId || !layout) return;
            const item = layout.nodeById.get(drag.hitId);
            if (item) selectNode(item);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setStageCursor(false, false);
          }}
          onPointerLeave={() => {
            if (dragRef.current) return;
            hoverRef.current = null;
            setStageCursor(false, false);
            updateTooltip(null, 0, 0);
            onHighlight?.(null);
            paintOverlay();
          }}
          onDoubleClick={(event) => {
            const point = worldPoint(event.clientX, event.clientY);
            const item = spatial?.hit(point.x, point.y) ?? null;
            if (!item) {
              fit();
              return;
            }
            if (item.node.kind === "aggregate") {
              selectNode(item);
              return;
            }
            onCursor({ mode: "historical", t: item.node.timestamp });
          }}
          onWheel={(event) => {
            event.preventDefault();
            const stage = stageRef.current;
            if (!stage) return;
            const rect = stage.getBoundingClientRect();
            const sx = event.clientX - rect.left;
            const sy = event.clientY - rect.top;
            if (event.metaKey || event.ctrlKey) {
              const view = viewRef.current;
              const oldZoom = view.zoom;
              const nextZoom = Math.max(
                0.16,
                Math.min(3.2, oldZoom * (event.deltaY > 0 ? 0.9 : 1.1)),
              );
              const wx = (sx - view.panX) / oldZoom;
              const wy = (sy - view.panY) / oldZoom;
              view.zoom = nextZoom;
              view.panX = sx - wx * nextZoom;
              view.panY = sy - wy * nextZoom;
            } else {
              viewRef.current.panX -= event.deltaX + (event.shiftKey ? event.deltaY : 0);
              viewRef.current.panY -= event.shiftKey ? 0 : event.deltaY;
            }
            paintAll();
          }}
          onKeyDown={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLElement &&
              (target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable)
            ) {
              return;
            }
            const key = event.key.toLowerCase();
            if (key === "f" && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              fit();
            } else if (key === "0") {
              event.preventDefault();
              resetTo100();
            } else if (key === "c" && expandedAggregates.size > 0) {
              event.preventDefault();
              collapseGroups();
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              stepInteraction(-1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              stepInteraction(1);
            } else if (key === "/" || ((event.metaKey || event.ctrlKey) && key === "f")) {
              event.preventDefault();
              focusSearch();
            } else if (
              searching &&
              (event.key === "Enter" ||
                event.key === "F3" ||
                event.key === "n" ||
                event.key === "N" ||
                ((event.metaKey || event.ctrlKey) && key === "g"))
            ) {
              event.preventDefault();
              stepSearch(event.shiftKey || event.key === "N" ? -1 : 1);
            } else if (event.key === "Escape") {
              if (searching) {
                event.preventDefault();
                clearSearch();
                return;
              }
              setFocusMode("all");
              setCustomFocus(null);
              hoverRef.current = null;
              updateTooltip(null, 0, 0);
              paintOverlay();
            }
          }}
        >
          <canvas ref={baseRef} />
          <canvas ref={overlayRef} className="rl-cascade-overlay" />
          <div
            className="rl-cascade-find"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <IconSearch size={12} />
            <input
              ref={searchInputRef}
              className="rl-cascade-find-input"
              type="search"
              spellCheck={false}
              autoComplete="off"
              placeholder="Find renders"
              aria-label="Find renders in this cascade"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (searching) clearSearch();
                  stageRef.current?.focus();
                } else if (
                  event.key === "Enter" ||
                  event.key === "F3" ||
                  ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g")
                ) {
                  event.preventDefault();
                  stepSearch(event.shiftKey ? -1 : 1);
                }
              }}
            />
            <span className="rl-cascade-find-count" aria-live="polite">
              {searchCount}
            </span>
            <button
              type="button"
              className="rl-cascade-find-step"
              title="Previous match (⇧Enter)"
              aria-label="Previous match"
              disabled={matches.length === 0}
              onClick={() => stepSearch(-1)}
            >
              <IconArrowUp size={11} />
            </button>
            <button
              type="button"
              className="rl-cascade-find-step"
              title="Next match (Enter)"
              aria-label="Next match"
              disabled={matches.length === 0}
              onClick={() => stepSearch(1)}
            >
              <IconArrowDown size={11} />
            </button>
          </div>
          {!projection || projection.nodes.length === 0 ? (
            <div className="rl-cascade-empty">
              No render cascade is available for this interaction.
            </div>
          ) : null}
          <div className="rl-cascade-tooltip" ref={tooltipRef} style={{ display: "none" }}>
            <strong ref={tooltipNameRef} />
            <span ref={tooltipMetaRef} />
          </div>
          {layout ? (
            <div
              className="rl-cascade-minimap-shell"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <canvas
                ref={minimapRef}
                className="rl-cascade-minimap"
                aria-label="Cascade minimap"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  minimapDragRef.current = event.pointerId;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  recenterFromMinimap(event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                  if (minimapDragRef.current === event.pointerId)
                    recenterFromMinimap(event.clientX, event.clientY);
                }}
                onPointerUp={(event) => {
                  if (minimapDragRef.current !== event.pointerId) return;
                  minimapDragRef.current = null;
                  try {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  } catch {}
                }}
                onPointerCancel={() => {
                  minimapDragRef.current = null;
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="rl-cascade-footer">
        <span>{footer}</span>
        <span className="spacer" />
        <span className="rl-cascade-help">
          drag pan · ⌘/ctrl+wheel zoom · 0 = 100% · / or ⌘F find · C collapse groups · F fit ·
          minimap drag · ←/→ interactions
        </span>
      </div>
    </div>
  );
}
