/**
 * Spawns the OffscreenCanvas timeline renderer for the base layer and transfers
 * control of that canvas into the worker. Overlay + pointer/keyboard stay on
 * the main thread. Falls back to null when OffscreenCanvas / Worker is
 * unavailable — Timeline keeps painting base via draw.ts.
 */

import type { AxisSnapshot, TimeSpan } from "./model/axis.js";
import type { ViewWindow } from "./model/viewport.js";
import type { LaneLayout } from "./model/rows.js";
import type { TimelineTheme } from "./view/timelineTheme.js";
import type { ClipRect } from "./view/draw.js";

export type TimelineBasePaintPayload = {
  axis: AxisSnapshot;
  view: ViewWindow;
  layout: LaneLayout;
  region: TimeSpan | null;
  markers: ReadonlyArray<{ t: number; label: string; warn: boolean }>;
  selectedRender: string | number | null;
  nameW: number;
  stageW: number;
  pxPerMs: number;
  tOrigin: number;
  theme: TimelineTheme;
};

export interface TimelineRendererClient {
  resize(width: number, height: number, dpr: number): void;
  paint(
    payload: TimelineBasePaintPayload,
    onHit?: (clipRects: Map<string, ClipRect>, snapEdges: number[]) => void,
  ): void;
  dispose(): void;
}

/** Survive React StrictMode remounts that reuse the same canvas node. */
const liveRenderers = new WeakMap<HTMLCanvasElement, TimelineRendererClient>();

export function createTimelineRenderer(canvas: HTMLCanvasElement): TimelineRendererClient | null {
  const existing = liveRenderers.get(canvas);
  if (existing) return existing;

  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined") return null;
  if (typeof canvas.transferControlToOffscreen !== "function") return null;

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
    e: MessageEvent<{
      type: string;
      clipRects?: Array<[string, ClipRect]>;
      snapEdges?: number[];
    }>,
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
  } catch {
    // Already transferred (remount race) or unsupported — fall back to main paint.
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
    worker.postMessage({ type: "paint", payload, wantHit: !!onHit });
  }

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
      liveRenderers.delete(canvas);
      worker.terminate();
    },
  };
  liveRenderers.set(canvas, client);
  return client;
}
