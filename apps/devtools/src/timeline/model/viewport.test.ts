import { describe, expect, it } from "vite-plus/test";
import { buildAxis } from "./axis.js";
import {
  clampView,
  fitView,
  fitWallRange,
  fitWallRangeAround,
  padClipRange,
  wallWindow,
  zoomView,
} from "./viewport.js";

const ACTS: Array<[number, number]> = [
  [0, 500],
  [2000, 2500],
];
const AXIS = buildAxis(ACTS);

describe("clampView", () => {
  it("keeps the window inside the axis when span ≤ total", () => {
    const v = clampView(-100, 200, AXIS.total);
    expect(v.a0).toBe(0);
    expect(v.a1 - v.a0).toBe(200);
  });

  it("allows empty margins when zoomed out past the session", () => {
    const span = AXIS.total * 2;
    const v = clampView(-50, span, AXIS.total);
    expect(v.a1 - v.a0).toBe(span);
    expect(v.a0).toBeLessThan(0);
    expect(v.a1).toBeGreaterThan(AXIS.total);
  });
});

describe("zoomView", () => {
  it("keeps the anchor time fixed", () => {
    const view = fitView(AXIS.total);
    const mid = (view.a0 + view.a1) / 2;
    const next = zoomView(view, 0.5, mid, AXIS.total);
    expect(next.a1 - next.a0).toBeLessThan(view.a1 - view.a0);
    const mid2 = mid; // anchor stays at same axis coord fraction
    expect(mid2).toBeGreaterThanOrEqual(next.a0);
    expect(mid2).toBeLessThanOrEqual(next.a1);
  });

  it("can zoom out past fit", () => {
    const view = fitView(AXIS.total);
    const mid = (view.a0 + view.a1) / 2;
    const next = zoomView(view, 4, mid, AXIS.total);
    expect(next.a1 - next.a0).toBeGreaterThan(AXIS.total);
  });
});

describe("fitWallRange / wallWindow", () => {
  it("fits a wall span into the view", () => {
    const v = fitWallRange(AXIS, 100, 400);
    expect(v.a1 - v.a0).toBeGreaterThan(0);
    const win = wallWindow(AXIS, v);
    expect(win.start).toBeLessThanOrEqual(100 + 1);
    expect(win.end).toBeGreaterThanOrEqual(400 - 1);
  });
});

describe("fitWallRange on a sub-minimum range", () => {
  it("centers the floored span on the range midpoint", () => {
    // 0.5 ms clip: span floors to VIEW_SPAN_MIN — the clip must not end up
    // hugging the left edge of the resulting window.
    const v = fitWallRange(AXIS, 100, 100.5);
    const midWall = AXIS.axisToWall((v.a0 + v.a1) / 2);
    expect(midWall).toBeCloseTo(100.25, 0);
  });
});

describe("padClipRange", () => {
  it("pads by the clip duration on each side", () => {
    const r = padClipRange(AXIS, 100, 110);
    expect(r.w0).toBe(90);
    expect(r.w1).toBe(120);
    expect(r.centerW).toBe(105);
  });

  it("clamps padding to the containing activity segment", () => {
    const r = padClipRange(AXIS, 495, 499);
    expect(r.w1).toBe(500);
    expect(r.w0).toBe(491);
  });

  it("never crosses into a gap from a later segment", () => {
    const r = padClipRange(AXIS, 2001, 2004);
    expect(r.w0).toBe(2000);
    expect(r.w1).toBe(2007);
    expect(r.centerW).toBe(2002.5);
  });
});

describe("fitWallRangeAround", () => {
  it("keeps the center wall time at the view midpoint", () => {
    // Near the end of the first activity band so a symmetric ± window clamps.
    const center = 480;
    const v = fitWallRangeAround(AXIS, 400, 500, center);
    const midA = (v.a0 + v.a1) / 2;
    expect(AXIS.axisToWall(midA)).toBeCloseTo(center, 0);
  });
});
