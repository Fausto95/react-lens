import { describe, expect, it } from "vite-plus/test";
import type { ClipRect } from "./clipRects.js";
import { hitTestClipRects } from "./hitTest.js";

function rect(id: number, visualX: number, visualWidth: number, hitX: number, hitWidth: number): ClipRect {
  return {
    x0: visualX,
    x1: visualX + visualWidth,
    y0: 10,
    y1: 28,
    clip: { renderId: id } as ClipRect["clip"],
    visual: { x: visualX, y: 10, width: visualWidth, height: 18 },
    hit: { x: hitX, y: 7, width: hitWidth, height: 24 },
    representation: visualWidth <= 2 ? "tick" : "clip",
  };
}

describe("hitTestClipRects", () => {
  it("prefers the actually painted clip over an overlapping expanded tick target", () => {
    const tick = rect(1, 50, 1, 45.5, 10);
    const clip = rect(2, 52, 8, 51, 10);
    const hit = hitTestClipRects({ x: 53, y: 18 }, [tick, clip]);
    expect(hit?.clip.renderId).toBe(2);
  });

  it("keeps a sub-pixel event selectable through its expanded target", () => {
    const tick = rect(3, 70, 1, 65.5, 10);
    const hit = hitTestClipRects({ x: 66, y: 18 }, [tick]);
    expect(hit?.clip.renderId).toBe(3);
  });
});
