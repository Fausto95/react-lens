/// <reference lib="webworker" />

import type { TimelineTheme } from "../view/timelineTheme.js";
import { drawCascadeBase, type CascadeViewport } from "./draw.js";
import type { CascadeLayout } from "./layout.js";

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let width = 1;
let height = 1;
let dpr = 1;
let layout: CascadeLayout | null = null;
let theme: TimelineTheme | null = null;
let maxSelfTime = 1;
let lastView: CascadeViewport | null = null;
let lastCursor: number | null = null;

function resize(nextWidth: number, nextHeight: number, nextDpr: number): void {
  width = Math.max(1, nextWidth);
  height = Math.max(1, nextHeight);
  dpr = Math.max(1, nextDpr);
  if (!canvas) return;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
}

function paint(view = lastView, cursorTime = lastCursor): void {
  if (!ctx || !layout || !theme || !view) return;
  lastView = { ...view, width, height, dpr };
  lastCursor = cursorTime;
  drawCascadeBase(ctx, layout, lastView, theme, {
    cursorTime,
    maxSelfTime,
    dimAfterCursor: true,
  });
}

self.onmessage = (
  event: MessageEvent<
    | { type: "init"; canvas: OffscreenCanvas; width: number; height: number; dpr: number }
    | { type: "resize"; width: number; height: number; dpr: number }
    | { type: "frame"; layout: CascadeLayout; theme: TimelineTheme; maxSelfTime: number }
    | { type: "paint"; view: CascadeViewport; cursorTime: number | null }
  >,
) => {
  const message = event.data;
  if (message.type === "init") {
    canvas = message.canvas;
    ctx = canvas.getContext("2d");
    resize(message.width, message.height, message.dpr);
    self.postMessage({ type: "ready" });
    return;
  }
  if (message.type === "resize") {
    resize(message.width, message.height, message.dpr);
    paint();
    return;
  }
  if (message.type === "frame") {
    layout = message.layout;
    theme = message.theme;
    maxSelfTime = Math.max(0.001, message.maxSelfTime);
    paint();
    return;
  }
  if (message.type === "paint") paint(message.view, message.cursorTime);
};

export {};
