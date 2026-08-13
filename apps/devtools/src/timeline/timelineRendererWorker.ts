/// <reference lib="webworker" />
/**
 * OffscreenCanvas timeline base-layer renderer.
 * Overlay + pointer/keyboard stay on the main thread.
 *
 * Prefers transferable columnar geometry; reconstructs Clip adapters for
 * drawBase so we never structured-clone millions of JS objects.
 */

import { hydrateAxis } from "./model/axis.js";
import { drawBase, ensureHatchPattern, type ClipRect } from "./view/draw.js";
import type { TimelineBasePaintPayload, TimelineGeometryPayload } from "./timelineRendererClient.js";
import type { Clip } from "./model/lanes.js";
import type { LayoutRow } from "./model/rows.js";
import { causeCodeToName, RenderFlags } from "@reactlens/trace-engine";
import type { ComponentId, RenderId } from "@reactlens/protocol";

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

function hydrateLayoutFromGeometry(
  payload: TimelineBasePaintPayload,
  geo: TimelineGeometryPayload,
): TimelineBasePaintPayload["layout"] {
  const byRow: Clip[][] = payload.layout.rows.map(() => []);
  for (let i = 0; i < geo.count; i++) {
    const ri = geo.rowIndex[i]!;
    if (ri < 0 || ri >= byRow.length) continue;
    const row = payload.layout.rows[ri]!;
    byRow[ri]!.push({
      renderId: geo.renderId[i]! as RenderId,
      componentId: 0 as ComponentId,
      laneKey: row.key,
      name: row.lane.name,
      t0: geo.x0[i]!,
      t1: geo.x1[i]!,
      self: geo.self[i]!,
      total: geo.x1[i]! - geo.x0[i]!,
      cause: causeCodeToName(geo.cause[i]!),
      wasted: (geo.flags[i]! & RenderFlags.Wasted) !== 0,
      row: geo.stackRow[i]!,
    });
  }
  const rows: LayoutRow[] = payload.layout.rows.map((r, i) => ({
    ...r,
    clips: byRow[i]!,
  }));
  return { ...payload.layout, rows };
}

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
      const layout =
        p.geometry && p.geometry.count > 0 ? hydrateLayoutFromGeometry(p, p.geometry) : p.layout;
      const { clipRects, snapEdges } = drawBase({
        ctx: g as unknown as CanvasRenderingContext2D,
        axis,
        view,
        layout,
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
