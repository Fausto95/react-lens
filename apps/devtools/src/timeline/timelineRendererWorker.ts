/// <reference lib="webworker" />

import { hydrateAxis } from "./model/axis.js";
import { drawBase, ensureHatchPattern, type ClipRect } from "./view/draw.js";
import type { TimelineBasePaintPayload } from "./timelineRendererClient.js";

type InMessage =
  | { type: "init"; width: number; height: number; dpr: number }
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "paint"; requestId: number; payload: TimelineBasePaintPayload; wantHit?: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let canvas: OffscreenCanvas | null = null;
let g: OffscreenCanvasRenderingContext2D | null = null;
let pattern: CanvasPattern | null = null;

scope.onmessage = (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      canvas = new OffscreenCanvas(1, 1);
      g = canvas.getContext("2d");
      if (!g) throw new Error("OffscreenCanvas 2d context unavailable");
      size(msg.width, msg.height, msg.dpr);
      pattern = ensureHatchPattern(g as unknown as CanvasRenderingContext2D);
      scope.postMessage({ type: "ready" });
      return;
    }

    if (!g || !canvas) throw new Error("Timeline renderer not initialized");

    if (msg.type === "resize") {
      size(msg.width, msg.height, msg.dpr);
      return;
    }

    const p = msg.payload;
    const axis = hydrateAxis(p.axis);
    const nw = p.nameW;
    const stageW = p.stageW;
    const view = p.view;
    const aToX = (a: number) => nw + ((a - view.a0) / (view.a1 - view.a0 || 1)) * (stageW - nw);
    const wToX = (t: number) => aToX(axis.wallToAxis(t));
    const { clipRects, snapEdges } = drawBase({
      ctx: g as unknown as CanvasRenderingContext2D,
      axis,
      view,
      layout: p.layout,
      ...(p.geometry ? { geometry: p.geometry } : {}),
      region: p.region,
      markers: p.markers,
      selectedRender: p.selectedRender,
      proj: { aToX, wToX, nameW: nw, stageW, pxPerMs: p.pxPerMs },
      pattern,
      tOrigin: p.tOrigin,
      theme: p.theme,
      viewMode: p.viewMode,
    });

    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage(
      {
        type: "frame",
        requestId: msg.requestId,
        bitmap,
        ...(msg.wantHit
          ? {
              clipRects: [...clipRects.entries()] as Array<[string, ClipRect]>,
              snapEdges,
            }
          : {}),
      },
      [bitmap],
    );
  } catch (err) {
    scope.postMessage({
      type: "error",
      requestId: msg.type === "paint" ? msg.requestId : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

function size(width: number, height: number, dpr: number): void {
  if (!canvas || !g) return;
  canvas.width = Math.max(1, Math.ceil(width * dpr));
  canvas.height = Math.max(1, Math.ceil(height * dpr));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  pattern = ensureHatchPattern(g as unknown as CanvasRenderingContext2D);
}
