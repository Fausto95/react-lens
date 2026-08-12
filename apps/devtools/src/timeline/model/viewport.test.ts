import { describe, expect, it } from "vite-plus/test";
import { buildAxis } from "./axis.js";
import {
  clampView,
  fitView,
  fitWallRange,
  fitWallRangeAround,
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

describe("fitWallRangeAround", () => {
  it("keeps the center wall time at the view midpoint", () => {
    // Near the end of the first activity band so a symmetric ± window clamps.
    const center = 480;
    const v = fitWallRangeAround(AXIS, 400, 500, center);
    const midA = (v.a0 + v.a1) / 2;
    expect(AXIS.axisToWall(midA)).toBeCloseTo(center, 0);
  });
});
