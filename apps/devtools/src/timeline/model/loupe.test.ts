import { describe, expect, it } from "vite-plus/test";
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

  it("maps the center to mid-canvas", () => {
    const win = loupeAt("t:A", 50);
    expect(loupeX(50, win, 100)).toBeCloseTo(50, 5);
  });
});
