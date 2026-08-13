import { describe, expect, it } from "vite-plus/test";
import { buildAxis } from "./axis.js";
import { WAVE_MIN_MS } from "./wave.js";
import {
  clipsInLoupe,
  loupeAnchor,
  loupeAt,
  loupeBarSpan,
  loupeX,
  loupeZoomHalf,
  LOUPE_HALF_MS,
  LOUPE_W,
} from "./loupe.js";

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

describe("loupeAnchor", () => {
  const NAME_W = 100;
  const STAGE_W = 800;

  it("centers the panel on the cursor in content coordinates", () => {
    const a = loupeAnchor(400, 300, 0, NAME_W, STAGE_W);
    expect(a.x).toBeCloseTo(400 - (LOUPE_W + 4) / 2, 0);
    expect(a.top).toBe(300 - 52);
  });

  it("keeps the panel inside the stage horizontally", () => {
    expect(loupeAnchor(110, 300, 0, NAME_W, STAGE_W).x).toBe(NAME_W + 4);
    expect(loupeAnchor(795, 300, 0, NAME_W, STAGE_W).x).toBe(STAGE_W - LOUPE_W - 8);
  });

  it("never inverts the clamp on a narrow stage", () => {
    const a = loupeAnchor(200, 300, 0, NAME_W, 250);
    expect(a.x).toBe(NAME_W + 4);
  });

  it("stays below the scrolled viewport top, not the content top", () => {
    // The panel lives in scrolled content coordinates: with the stage scrolled
    // down 200px, a row at y=240 must not place the loupe above the fold.
    const a = loupeAnchor(400, 240, 200, NAME_W, STAGE_W);
    expect(a.top).toBe(202);
  });
});

describe("loupeZoomHalf", () => {
  it("uses the full half-window when the view is wide", () => {
    expect(loupeZoomHalf(5000)).toBe(LOUPE_HALF_MS);
  });

  it("keeps zooming in when the view is already tighter than the window", () => {
    // Click-to-zoom must never zoom OUT: at a 68-unit view span the ±34 window
    // would be a no-op, so the half shrinks to a quarter of the span.
    expect(loupeZoomHalf(68)).toBe(17);
    expect(loupeZoomHalf(20)).toBe(5);
  });
});

describe("loupeBarSpan", () => {
  it("paints the exclusive self span, matching the wave histogram", () => {
    expect(loupeBarSpan({ t0: 100, t1: 200, self: 10 })).toEqual({ t0: 100, t1: 110 });
  });

  it("floors zero-self clips at the wave minimum", () => {
    expect(loupeBarSpan({ t0: 100, t1: 200, self: 0 })).toEqual({
      t0: 100,
      t1: 100 + WAVE_MIN_MS,
    });
  });
});
