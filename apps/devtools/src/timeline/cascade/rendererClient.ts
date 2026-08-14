import type { TimelineTheme } from "../view/timelineTheme.js";
import type { CascadeLayout } from "./layout.js";
import type { CascadeViewport } from "./draw.js";

export interface CascadeRendererClient {
  setFrame(layout: CascadeLayout, theme: TimelineTheme, maxSelfTime: number): void;
  paint(view: CascadeViewport, cursorTime: number | null): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

const live = new WeakMap<HTMLCanvasElement, CascadeRendererClient>();

/**
 * Base graph paint runs off-main-thread when supported. Pointer geometry and
 * overlay stay on main thread, so hover never round-trips through the worker.
 */
export function createCascadeRenderer(canvas: HTMLCanvasElement): CascadeRendererClient | null {
  const existing = live.get(canvas);
  if (existing) return existing;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  if (typeof canvas.transferControlToOffscreen !== "function") return null;

  let worker: Worker;
  try {
    worker = new Worker(new URL("./rendererWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  let offscreen: OffscreenCanvas;
  try {
    offscreen = canvas.transferControlToOffscreen();
  } catch {
    worker.terminate();
    return null;
  }

  let ready = false;
  const queue: unknown[] = [];
  worker.onmessage = (event: MessageEvent<{ type?: string }>) => {
    if (event.data.type !== "ready") return;
    ready = true;
    for (const message of queue) worker.postMessage(message);
    queue.length = 0;
  };

  const post = (message: unknown) => {
    if (ready) worker.postMessage(message);
    else queue.push(message);
  };

  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  worker.postMessage(
    {
      type: "init",
      canvas: offscreen,
      width: Math.max(1, canvas.clientWidth || canvas.width),
      height: Math.max(1, canvas.clientHeight || canvas.height),
      dpr,
    },
    [offscreen],
  );

  const client: CascadeRendererClient = {
    setFrame(layout, theme, maxSelfTime) {
      // nodeById is a main-thread interaction index. Do not clone it into the worker.
      post({
        type: "frame",
        layout: {
          nodes: layout.nodes,
          edges: layout.edges,
          worldWidth: layout.worldWidth,
          worldHeight: layout.worldHeight,
          nodeById: new Map(),
        },
        theme,
        maxSelfTime,
      });
    },
    paint(view, cursorTime) {
      post({ type: "paint", view, cursorTime });
    },
    resize(width, height, nextDpr) {
      post({ type: "resize", width, height, dpr: nextDpr });
    },
    dispose() {
      live.delete(canvas);
      worker.terminate();
    },
  };
  live.set(canvas, client);
  return client;
}
