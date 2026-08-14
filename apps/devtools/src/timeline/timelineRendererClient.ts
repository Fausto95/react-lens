/**
 * Spawns the OffscreenCanvas timeline renderer for the base layer and transfers
 * control of that canvas into the worker. Overlay + pointer/keyboard stay on
 * the main thread.
 */

import type { AxisSnapshot, TimeSpan } from "./model/axis.js";
import type { ViewWindow } from "./model/viewport.js";
import type { LaneLayout } from "./model/rows.js";
import type { TimelineTheme } from "./view/timelineTheme.js";
import type { ClipRect, TimelineViewMode } from "./view/draw.js";

export type TimelineGeometryPayload = {
  count: number;
  rowIndex: Uint32Array;
  x0: Float64Array;
  x1: Float64Array;
  self: Float32Array;
  renderId: Uint32Array;
  componentId: Uint32Array;
  cause: Uint8Array;
  flags: Uint8Array;
  stackRow: Uint16Array;
  aggregate: Uint8Array;
  renderCount: Uint32Array;
  wastedCount: Uint32Array;
};

export type TimelineBasePaintPayload = {
  axis: AxisSnapshot;
  view: ViewWindow;
  layout: LaneLayout;
  geometry?: TimelineGeometryPayload;
  region: TimeSpan | null;
  markers: ReadonlyArray<{ t: number; label: string; warn: boolean }>;
  selectedRender: string | number | null;
  nameW: number;
  stageW: number;
  pxPerMs: number;
  tOrigin: number;
  theme: TimelineTheme;
  viewMode?: TimelineViewMode;
};

export interface TimelineRendererClient {
  resize(width: number, height: number, dpr: number): void;
  paint(
    payload: TimelineBasePaintPayload,
    onHit?: (clipRects: Map<string, ClipRect>, snapEdges: number[]) => void,
  ): void;
  dispose(): void;
}

type RendererRecord = {
  client: TimelineRendererClient;
  cancelDispose: () => void;
};

/**
 * `transferControlToOffscreen()` is permanent for a DOM canvas. React Strict
 * Mode mounts effects, cleans them up, then mounts them again while reusing the
 * same canvas node, so renderer disposal must be deferred long enough for that
 * remount to reclaim the worker.
 */
const liveRenderers = new WeakMap<HTMLCanvasElement, RendererRecord>();
const transferredCanvases = new WeakSet<HTMLCanvasElement>();

export function isTimelineCanvasTransferred(canvas: HTMLCanvasElement): boolean {
  return transferredCanvases.has(canvas);
}

export function createTimelineRenderer(canvas: HTMLCanvasElement): TimelineRendererClient | null {
  const existing = liveRenderers.get(canvas);
  if (existing) {
    existing.cancelDispose();
    return existing.client;
  }
  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined") return null;
  if (typeof canvas.transferControlToOffscreen !== "function") return null;
  // A transferred canvas can never fall back to DOM 2D or be transferred a
  // second time. If no live renderer owns it, fail closed rather than throwing.
  if (transferredCanvases.has(canvas)) return null;

  let worker: Worker;
  try {
    worker = new Worker(new URL("./timelineRendererWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }

  let ready = false;
  const pending: Array<{
    payload: TimelineBasePaintPayload;
    onHit?: (clipRects: Map<string, ClipRect>, snapEdges: number[]) => void;
  }> = [];
  let hitCb: ((clipRects: Map<string, ClipRect>, snapEdges: number[]) => void) | null = null;

  worker.onmessage = (
    e: MessageEvent<{ type: string; clipRects?: Array<[string, ClipRect]>; snapEdges?: number[] }>,
  ) => {
    if (e.data?.type === "ready") {
      ready = true;
      for (const p of pending) paintNow(p.payload, p.onHit);
      pending.length = 0;
      return;
    }
    if (e.data?.type === "hit" && e.data.clipRects && e.data.snapEdges) {
      hitCb?.(new Map(e.data.clipRects), e.data.snapEdges);
      hitCb = null;
    }
  };

  let offscreen: OffscreenCanvas;
  try {
    offscreen = canvas.transferControlToOffscreen();
    transferredCanvases.add(canvas);
  } catch {
    worker.terminate();
    return null;
  }

  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  worker.postMessage(
    {
      type: "init",
      canvas: offscreen,
      width: canvas.clientWidth || canvas.width,
      height: canvas.clientHeight || canvas.height,
      dpr,
    },
    [offscreen],
  );

  function paintNow(
    payload: TimelineBasePaintPayload,
    onHit?: (clipRects: Map<string, ClipRect>, snapEdges: number[]) => void,
  ): void {
    if (onHit) hitCb = onHit;
    const transfer: Transferable[] = [];
    const geo = payload.geometry;
    if (geo && geo.count > 0) {
      for (const buf of [
        geo.rowIndex.buffer,
        geo.x0.buffer,
        geo.x1.buffer,
        geo.self.buffer,
        geo.renderId.buffer,
        geo.componentId.buffer,
        geo.cause.buffer,
        geo.flags.buffer,
        geo.stackRow.buffer,
        geo.aggregate.buffer,
        geo.renderCount.buffer,
        geo.wastedCount.buffer,
      ]) {
        if (buf instanceof ArrayBuffer) transfer.push(buf);
      }

      // At far semantic zoom the worker paints aggregate density from the
      // viewport lane clips. Keep those lightweight LOD clips; detailed zoom
      // strips objects and uses only transferable columns.
      const keepLaneClips = payload.viewMode === "density" || payload.pxPerMs < 30;
      if (!keepLaneClips) {
        const stripLaneClips = <T extends { clips: unknown[] }>(lane: T): T => ({
          ...lane,
          clips: [] as unknown[] as T["clips"],
        });
        const slim = {
          ...payload,
          layout: {
            ...payload.layout,
            rows: payload.layout.rows.map((r) => ({
              ...r,
              lane: stripLaneClips(r.lane),
              clips: [] as typeof r.clips,
            })),
            quietLanes: payload.layout.quietLanes.map(stripLaneClips),
          },
        };
        worker.postMessage({ type: "paint", payload: slim, wantHit: !!onHit }, transfer);
        return;
      }
      worker.postMessage({ type: "paint", payload, wantHit: !!onHit }, transfer);
      return;
    }
    worker.postMessage({ type: "paint", payload, wantHit: !!onHit });
  }

  let disposeTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelDispose = () => {
    if (disposeTimer === null) return;
    clearTimeout(disposeTimer);
    disposeTimer = null;
  };

  const client: TimelineRendererClient = {
    resize(width, height, nextDpr) {
      worker.postMessage({ type: "resize", width, height, dpr: nextDpr });
    },
    paint(payload, onHit) {
      if (!ready) {
        pending.push({ payload, onHit });
        return;
      }
      paintNow(payload, onHit);
    },
    dispose() {
      // Strict Mode immediately remounts and calls createTimelineRenderer on
      // the same node. A macrotask delay lets that remount cancel disposal.
      if (disposeTimer !== null) return;
      disposeTimer = setTimeout(() => {
        disposeTimer = null;
        const record = liveRenderers.get(canvas);
        if (!record || record.client !== client) return;
        liveRenderers.delete(canvas);
        worker.terminate();
      }, 0);
    },
  };

  liveRenderers.set(canvas, { client, cancelDispose });
  return client;
}
