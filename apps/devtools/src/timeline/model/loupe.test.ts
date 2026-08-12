import { describe, expect, it } from "vite-plus/test";
import { buildAxis } from "./axis.js";
import { clipsInLoupe, loupeAt, loupeX, LOUPE_HALF_MS } from "./loupe.js";

describe("loupe", () => {
  it("builds a ±HALF window", () => {
    const win = loupeAt("t:A", 1000);
    expect(win.t0).toBe(1000 - LOUPE_HALF_MS);
    expect(win.t1).toBe(1000 + LOUPE_HALF_MS);
  });

  it("filters clips to the window", () => {
    const win = loupeAt("t:A", 100);
    const clips = clipsInLoupe(
      [
        { t0: 90, t1: 95 },
        { t0: 200, t1: 210 },
      ],
      win,
    );
    expect(clips).toHaveLength(1);
  });

  it("maps the center to mid-canvas when the window is symmetric", () => {
    const win = loupeAt("t:A", 50);
    expect(loupeX(50, win, 100)).toBeCloseTo(50, 5);
  });

  it("clamps the window to the containing activity segment", () => {
    const axis = buildAxis([
      [0, 100],
      [1000, 1100],
    ]);
    const win = loupeAt("t:A", 90, 34, axis);
    expect(win.t0).toBeGreaterThanOrEqual(0);
    expect(win.t1).toBeLessThanOrEqual(100);
    expect(win.t1).toBe(100);
  });
});
