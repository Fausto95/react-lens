/**
 * Worker-backed timeline renderer.
 *
 * The DOM canvas stays owned by the panel. Heavy layout/paint runs on a worker-
 * owned OffscreenCanvas and arrives as an ImageBitmap; the main thread only
 * performs a cheap bitmap blit. If the worker fails, the normal DOM canvas is
 * still usable for a correctness fallback — unlike transferControlToOffscreen.
 */

import type { AxisSnapshot, TimeSpan } from "./model/axis.js";
import { hydrateAxis } from "./model/axis.js";
import type { ViewWindow } from "./model/viewport.js";
import type { LaneLayout } from "./model/rows.js";
import type { TimelineTheme } from "./view/timelineTheme.js";
import {
  drawBase,
  ensureHatchPattern,
  type ClipRect,
  type TimelineViewMode,
} from "./view/draw.js";

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

type PendingPaint = {
  payload: TimelineBasePaintPayload;
  onHit?: (clipRects: Map<string, ClipRect>, snapEdges: number[]) => void;
};

type WorkerMessage =
  | { type: "ready" }
  | {
      type: "frame";
      requestId: number;
      bitmap: ImageBitmap;
      clipRects?: Array<[string, ClipRect]>;
      snapEdges?: number[];
    }
  | { type: "error"; requestId?: number; message: string };

const liveRenderers = new WeakMap<HTMLCanvasElement, RendererRecord>();

export function isTimelineCanvasTransferred(_canvas: HTMLCanvasElement): boolean {
  // Kept for callers/tests from the previous implementation. The DOM canvas is
  // intentionally never transferred anymore.
  return false;
}

export function createTimelineRenderer(canvas: HTMLCanvasElement): TimelineRendererClient | null {
  const existing = liveRenderers.get(canvas);
  if (existing) {
    existing.cancelDispose();
    return existing.client;
  }
  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined") return null;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let worker: Worker;
  try {
    worker = new Worker(new URL("./timelineRendererWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let width = Math.max(1, canvas.clientWidth || canvas.width || 1);
  let height = Math.max(1, canvas.clientHeight || canvas.height || 1);
  let dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  let ready = false;
  let failed = false;
  let requestId = 0;
  let lastApplied = 0;
  let pending: PendingPaint | null = null;
  let lastSubmitted: PendingPaint | null = null;
  const callbacks = new Map<
    number,
    ((clipRects: Map<string, ClipRect>, snapEdges: number[]) => void) | undefined
  >();
  let fallbackPattern: CanvasPattern | null = null;

  const sizeDomCanvas = () => {
    canvas.width = Math.max(1, Math.ceil(width * dpr));
    canvas.height = Math.max(1, Math.ceil(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  };

  const fallbackPaint = (item: PendingPaint) => {
    sizeDomCanvas();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!fallbackPattern) fallbackPattern = ensureHatchPattern(ctx);
    const p = item.payload;
    const axis = hydrateAxis(p.axis);
    const aToX = (a: number) =>
      p.nameW + ((a - p.view.a0) / (p.view.a1 - p.view.a0 || 1)) * (p.stageW - p.nameW);
    const wToX = (t: number) => aToX(axis.wallToAxis(t));
    const result = drawBase({
      ctx,
      axis,
      view: p.view,
      layout: p.layout,
      ...(p.geometry ? { geometry: p.geometry } : {}),
      region: p.region,
      markers: p.markers,
      selectedRender: p.selectedRender,
      proj: { aToX, wToX, nameW: p.nameW, stageW: p.stageW, pxPerMs: p.pxPerMs },
      pattern: fallbackPattern,
      tOrigin: p.tOrigin,
      theme: p.theme,
      viewMode: p.viewMode,
    });
    item.onHit?.(result.clipRects, result.snapEdges);
  };

  const fail = () => {
    if (failed) return;
    failed = true;
    worker.terminate();
    callbacks.clear();
    const item = lastSubmitted ?? pending;
    pending = null;
    if (item) fallbackPaint(item);
  };

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === "ready") {
      ready = true;
      const item = pending;
      pending = null;
      if (item) sendPaint(item);
      return;
    }
    if (message.type === "error") {
      fail();
      return;
    }
    if (message.type !== "frame") return;

    const callback = callbacks.get(message.requestId);
    callbacks.delete(message.requestId);
    if (message.requestId < lastApplied) {
      message.bitmap.close();
      return;
    }
    lastApplied = message.requestId;

    sizeDomCanvas();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(message.bitmap, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    message.bitmap.close();

    if (callback && message.clipRects && message.snapEdges) {
      callback(new Map(message.clipRects), message.snapEdges);
    }
    for (const id of callbacks.keys()) {
      if (id < lastApplied) callbacks.delete(id);
    }
  };
  worker.onerror = () => fail();
  worker.onmessageerror = () => fail();

  function sendPaint(item: PendingPaint): void {
    if (failed) {
      fallbackPaint(item);
      return;
    }
    lastSubmitted = item;
    const id = ++requestId;
    callbacks.set(id, item.onHit);

    // Do not transfer the query's source buffers: transfer would detach them and
    // make subsequent paints/hover updates observe empty arrays. Structured clone
    // is bounded by the viewport primitive cap and preserves the authoritative
    // query result on the panel side.
    const p = item.payload;
    const keepLaneClips = p.viewMode === "density" || p.pxPerMs < 2;
    const payload = !p.geometry || keepLaneClips
      ? p
      : {
          ...p,
          layout: {
            ...p.layout,
            rows: p.layout.rows.map((row) => ({
              ...row,
              lane: { ...row.lane, clips: [] },
              clips: [] as typeof row.clips,
            })),
            quietLanes: [],
          },
        };
    worker.postMessage({ type: "paint", requestId: id, payload, wantHit: !!item.onHit });
  }

  sizeDomCanvas();
  worker.postMessage({ type: "init", width, height, dpr });

  let disposeTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelDispose = () => {
    if (disposeTimer === null) return;
    clearTimeout(disposeTimer);
    disposeTimer = null;
  };

  const client: TimelineRendererClient = {
    resize(nextWidth, nextHeight, nextDpr) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      dpr = Math.max(1, nextDpr);
      sizeDomCanvas();
      if (!failed) worker.postMessage({ type: "resize", width, height, dpr });
    },
    paint(payload, onHit) {
      const item = { payload, onHit };
      lastSubmitted = item;
      if (failed) {
        fallbackPaint(item);
        return;
      }
      if (!ready) {
        // Coalesce startup churn. Only the freshest viewport deserves a frame.
        pending = item;
        return;
      }
      sendPaint(item);
    },
    dispose() {
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
