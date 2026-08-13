/// <reference lib="webworker" />
/**
 * OffscreenCanvas timeline base-layer renderer.
 * Overlay + pointer/keyboard stay on the main thread.
 */

import { hydrateAxis } from "./model/axis.js";
import { drawBase, ensureHatchPattern, type ClipRect } from "./view/draw.js";
import type { TimelineBasePaintPayload } from "./timelineRendererClient.js";

type InMessage =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      width: number;
      height: number;
      dpr: number;
    }
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "paint"; payload: TimelineBasePaintPayload; wantHit?: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;

let canvas: OffscreenCanvas | null = null;
let g: OffscreenCanvasRenderingContext2D | null = null;
let pattern: CanvasPattern | null = null;

scope.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      canvas = msg.canvas;
      g = canvas.getContext("2d");
      if (!g) throw new Error("OffscreenCanvas 2d context unavailable");
      size(msg.width, msg.height, msg.dpr);
      pattern = ensureHatchPattern(g as unknown as CanvasRenderingContext2D);
      scope.postMessage({ type: "ready" });
      return;
    }
    if (!g || !canvas) return;
    if (msg.type === "resize") {
      size(msg.width, msg.height, msg.dpr);
      return;
    }
    if (msg.type === "paint") {
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
        region: p.region,
        markers: p.markers,
        selectedRender: p.selectedRender,
        proj: { aToX, wToX, nameW: nw, stageW, pxPerMs: p.pxPerMs },
        pattern,
        tOrigin: p.tOrigin,
        theme: p.theme,
      });
      if (msg.wantHit) {
        scope.postMessage({
          type: "hit",
          clipRects: [...clipRects.entries()] as Array<[string, ClipRect]>,
          snapEdges,
        });
      }
    }
  } catch (err) {
    scope.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

function size(width: number, height: number, dpr: number): void {
  if (!canvas || !g) return;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
