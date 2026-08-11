import { describe, it, expect } from "vite-plus/test";
import { projectT, projectX } from "./scale.js";
import {
  contentWidth,
  clampScroll,
  followScroll,
  maxScroll,
  resolveZoom,
  viewportScale,
  windowOf,
  type Viewport,
} from "./viewport.js";

/** A session with two bursts of activity separated by a long idle gap. */
const BOUNDS = { t0: 1000, t1: 41000 };
const ACTIVE: Array<[number, number]> = [
  [1000, 1600],
  [40000, 41000],
];

const vp = (over: Partial<Viewport> = {}): Viewport => ({
  zoom: "fit",
  scrollLeft: 0,
  width: 800,
  ...over,
});

describe("resolveZoom", () => {
  it("'fit' fills the viewport with the whole session", () => {
    const px = resolveZoom(vp(), BOUNDS, ACTIVE);
    const width = contentWidth(viewportScale(vp({ zoom: px }), BOUNDS, ACTIVE));
    expect(Math.abs(width - 800)).toBeLessThanOrEqual(2);
  });

  it("passes a concrete px/ms through untouched", () => {
    expect(resolveZoom(vp({ zoom: 3 }), BOUNDS, ACTIVE)).toBe(3);
  });

  it("never resolves to zero or a negative scale", () => {
    expect(resolveZoom(vp({ width: 0 }), BOUNDS, ACTIVE)).toBeGreaterThan(0);
  });
});

describe("viewportScale", () => {
  it("compresses idle so the gap costs a fixed gutter, not 39 seconds of width", () => {
    const scale = viewportScale(vp({ zoom: 1 }), BOUNDS, ACTIVE);
    const idle = scale.segs.filter((s) => s.idle);
    expect(idle).toHaveLength(1);
    // 38.4s of idle rendered in well under the width of 1.6s of active time.
    const idleWidth = idle[0]!.x1 - idle[0]!.x0;
    expect(idleWidth).toBeLessThan(100);
  });

  it("spans the whole session, not just the visible window", () => {
    const scale = viewportScale(vp({ zoom: 1, scrollLeft: 400 }), BOUNDS, ACTIVE);
    expect(projectT(scale.segs, 0)).toBeCloseTo(BOUNDS.t0, 5);
    expect(projectT(scale.segs, contentWidth(scale))).toBeCloseTo(BOUNDS.t1, 5);
  });
});

describe("windowOf", () => {
  it("is derived from the scroll offset — never stored", () => {
    const state = vp({ zoom: 1, scrollLeft: 0 });
    const scale = viewportScale(state, BOUNDS, ACTIVE);
    const win = windowOf(scale, state.scrollLeft, state.width);
    expect(win.start).toBeCloseTo(BOUNDS.t0, 5);
  });

  it("moves forward in time as the canvas scrolls", () => {
    const state = vp({ zoom: 1 });
    const scale = viewportScale(state, BOUNDS, ACTIVE);
    const a = windowOf(scale, 0, state.width);
    const b = windowOf(scale, 200, state.width);
    expect(b.start).toBeGreaterThan(a.start);
  });

  it("round-trips through the projection it was derived from", () => {
    const state = vp({ zoom: 1, scrollLeft: 150 });
    const scale = viewportScale(state, BOUNDS, ACTIVE);
    const win = windowOf(scale, state.scrollLeft, state.width);
    expect(projectX(scale.segs, win.start)).toBeCloseTo(150, 4);
  });
});

describe("scroll bounds", () => {
  it("maxScroll is the content that does not fit", () => {
    const state = vp({ zoom: 2 });
    const scale = viewportScale(state, BOUNDS, ACTIVE);
    expect(maxScroll(scale, state.width)).toBeCloseTo(
      Math.max(0, contentWidth(scale) - state.width),
      5,
    );
  });

  it("is zero when everything already fits", () => {
    const state = vp({ zoom: "fit" });
    const scale = viewportScale(state, BOUNDS, ACTIVE);
    expect(maxScroll(scale, state.width)).toBeLessThanOrEqual(2);
  });

  it("clamps out-of-range offsets instead of allowing blank canvas", () => {
    const state = vp({ zoom: 2 });
    const scale = viewportScale(state, BOUNDS, ACTIVE);
    expect(clampScroll(-500, scale, state.width)).toBe(0);
    expect(clampScroll(1e9, scale, state.width)).toBeCloseTo(maxScroll(scale, state.width), 5);
  });
});

describe("followScroll", () => {
  const width = 600;
  const max = 4000;

  it("leaves the view alone while the playhead is comfortably inside it", () => {
    expect(followScroll(300, 0, width, max)).toBe(null);
    expect(followScroll(1200, 1000, width, max)).toBe(null);
  });

  it("scrolls ahead once the playhead nears the right edge", () => {
    const next = followScroll(590, 0, width, max);
    expect(next).not.toBe(null);
    // The playhead lands with room ahead of it, not pinned to the edge — so a
    // continuing replay does not re-scroll every single frame.
    expect(590 - next!).toBeLessThan(width);
    expect(590 - next!).toBeGreaterThan(0);
  });

  it("scrolls back when the playhead is behind the view", () => {
    const next = followScroll(100, 900, width, max);
    expect(next).not.toBe(null);
    expect(next!).toBeLessThan(900);
  });

  it("never scrolls past the ends of the content", () => {
    expect(followScroll(10, 500, width, max)).toBeGreaterThanOrEqual(0);
    expect(followScroll(max + width, 0, width, max)).toBeLessThanOrEqual(max);
  });

  it("returns null rather than a no-op scroll at the very end", () => {
    // Already scrolled as far as it goes: following further would dispatch an
    // action every frame that changes nothing.
    expect(followScroll(max + width, max, width, max)).toBe(null);
  });
});
