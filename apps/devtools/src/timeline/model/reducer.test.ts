import { describe, it, expect } from "vite-plus/test";
import type { RenderId } from "@reactlens/protocol";
import { typeLaneKey } from "../../laneFilter.js";
import { projectT } from "./scale.js";
import { initialTimelineState, timelineReducer, type TimelineContext } from "./reducer.js";
import { resolveZoom, viewportScale, windowOf } from "./viewport.js";

const CTX: TimelineContext = {
  bounds: { t0: 1000, t1: 41000 },
  active: [
    [1000, 1600],
    [40000, 41000],
  ],
};

const start = (over: Parameters<typeof initialTimelineState>[0] = {}) =>
  timelineReducer(initialTimelineState(over), { type: "measure", width: 800 }, CTX);

/** Time currently under a given viewport-relative pixel. */
function timeAt(state: ReturnType<typeof start>, x: number): number {
  const scale = viewportScale(state.viewport, CTX.bounds, CTX.active);
  return projectT(scale.segs, state.viewport.scrollLeft + x);
}

describe("measure", () => {
  it("records the scrollport width", () => {
    expect(start().viewport.width).toBe(800);
  });

  it("ignores a zero width so a hidden panel cannot destroy the scale", () => {
    const s = timelineReducer(start(), { type: "measure", width: 0 }, CTX);
    expect(s.viewport.width).toBe(800);
  });
});

describe("zoom", () => {
  it("zoomBy makes the scale coarser or finer", () => {
    const base = start();
    const before = resolveZoom(base.viewport, CTX.bounds, CTX.active);
    const zoomed = timelineReducer(base, { type: "zoomBy", factor: 2 }, CTX);
    const after = resolveZoom(zoomed.viewport, CTX.bounds, CTX.active);
    expect(after).toBeGreaterThan(before);
  });

  it("keeps the time under the anchor pixel fixed — the invariant zoom kept breaking", () => {
    const base = timelineReducer(start(), { type: "zoomBy", factor: 4 }, CTX);
    const anchorX = 300;
    const before = timeAt(base, anchorX);
    const zoomed = timelineReducer(base, { type: "zoomBy", factor: 2, anchorX }, CTX);
    const after = timeAt(zoomed, anchorX);
    // Sub-millisecond drift is acceptable; visible drift is the bug.
    expect(Math.abs(after - before)).toBeLessThan(1);
  });

  it("leaving 'fit' produces a concrete scale, and fit returns to it", () => {
    const zoomed = timelineReducer(start(), { type: "zoomBy", factor: 2 }, CTX);
    expect(zoomed.viewport.zoom).not.toBe("fit");
    const refit = timelineReducer(zoomed, { type: "fit" }, CTX);
    expect(refit.viewport.zoom).toBe("fit");
    expect(refit.viewport.scrollLeft).toBe(0);
  });

  it("clamps rather than running away on repeated zoom-in", () => {
    let s = start();
    for (let i = 0; i < 200; i++) s = timelineReducer(s, { type: "zoomBy", factor: 2 }, CTX);
    expect(Number.isFinite(resolveZoom(s.viewport, CTX.bounds, CTX.active))).toBe(true);
    expect(s.viewport.scrollLeft).toBeGreaterThanOrEqual(0);
  });

  it("zoomTo sets an absolute scale, so a slider can drive it directly", () => {
    const s = timelineReducer(start(), { type: "zoomTo", pxPerMs: 3 }, CTX);
    expect(resolveZoom(s.viewport, CTX.bounds, CTX.active)).toBeCloseTo(3, 6);
  });

  it("zoomTo keeps the anchor time fixed, like zoomBy", () => {
    const base = timelineReducer(start(), { type: "zoomBy", factor: 4 }, CTX);
    const anchorX = 250;
    const before = timeAt(base, anchorX);
    const zoomed = timelineReducer(base, { type: "zoomTo", pxPerMs: 12, anchorX }, CTX);
    expect(Math.abs(timeAt(zoomed, anchorX) - before)).toBeLessThan(1);
  });

  it("fitRange frames a span inside the viewport", () => {
    const s = timelineReducer(start(), { type: "fitRange", span: { start: 1000, end: 1600 } }, CTX);
    const scale = viewportScale(s.viewport, CTX.bounds, CTX.active);
    const win = windowOf(scale, s.viewport.scrollLeft, s.viewport.width);
    expect(win.start).toBeLessThanOrEqual(1000 + 1);
    expect(win.end).toBeGreaterThanOrEqual(1600 - 1);
  });
});

describe("scroll and pan", () => {
  const zoomedIn = () => timelineReducer(start(), { type: "zoomBy", factor: 8 }, CTX);

  it("pan and its inverse return to the same offset", () => {
    const base = zoomedIn();
    const there = timelineReducer(base, { type: "panBy", dx: 120 }, CTX);
    const back = timelineReducer(there, { type: "panBy", dx: -120 }, CTX);
    expect(back.viewport.scrollLeft).toBeCloseTo(base.viewport.scrollLeft, 5);
  });

  it("clamps scroll into the canvas instead of showing blank space", () => {
    const s = timelineReducer(zoomedIn(), { type: "scrolled", scrollLeft: -400 }, CTX);
    expect(s.viewport.scrollLeft).toBe(0);
  });

  it("scrolling is the only writer of the offset — the window follows it", () => {
    const s = timelineReducer(zoomedIn(), { type: "scrolled", scrollLeft: 200 }, CTX);
    expect(s.viewport.scrollLeft).toBe(200);
    const scale = viewportScale(s.viewport, CTX.bounds, CTX.active);
    const win = windowOf(scale, s.viewport.scrollLeft, s.viewport.width);
    expect(win.start).toBeGreaterThan(CTX.bounds.t0);
  });
});

describe("region", () => {
  it("normalises a span dragged backwards", () => {
    const s = timelineReducer(start(), { type: "setRegion", span: { start: 900, end: 400 } }, CTX);
    expect(s.region).toEqual({ start: 400, end: 900 });
  });

  it("swaps edges when one is dragged past the other", () => {
    const set = timelineReducer(
      start(),
      { type: "setRegion", span: { start: 1100, end: 1400 } },
      CTX,
    );
    const dragged = timelineReducer(set, { type: "dragRegionEdge", side: "start", t: 1500 }, CTX);
    expect(dragged.region).toEqual({ start: 1400, end: 1500 });
  });

  it("clears to null", () => {
    const set = timelineReducer(
      start(),
      { type: "setRegion", span: { start: 1100, end: 1400 } },
      CTX,
    );
    expect(timelineReducer(set, { type: "setRegion", span: null }, CTX).region).toBeNull();
  });
});

describe("selection and lanes", () => {
  it("selecting a clip records the render and its lane", () => {
    const s = timelineReducer(
      start(),
      { type: "selectClip", renderId: 7 as RenderId, laneKey: typeLaneKey("Cart") },
      CTX,
    );
    expect(s.selectedRender).toBe(7);
    expect(s.selectedLane).toBe(typeLaneKey("Cart"));
  });

  it("toggling a lane adds then removes it", () => {
    const key = typeLaneKey("ListItem");
    const open = timelineReducer(start(), { type: "toggleLane", key }, CTX);
    expect(open.expandedLanes.has(key)).toBe(true);
    expect(timelineReducer(open, { type: "toggleLane", key }, CTX).expandedLanes.has(key)).toBe(
      false,
    );
  });

  it("expandLanes is idempotent, so auto-expanding a cascade cannot loop", () => {
    const keys = [typeLaneKey("A"), typeLaneKey("B")];
    const once = timelineReducer(start(), { type: "expandLanes", keys }, CTX);
    const twice = timelineReducer(once, { type: "expandLanes", keys }, CTX);
    expect(twice).toBe(once);
  });
});

describe("transport", () => {
  it("play and pause flip the flag", () => {
    const playing = timelineReducer(start(), { type: "play", from: null }, CTX);
    expect(playing.playing).toBe(true);
    expect(timelineReducer(playing, { type: "pause" }, CTX).playing).toBe(false);
  });

  it("remembers where the replay was started from, and forgets it on pause", () => {
    // The replay span is derived from this, so a stale value would make the
    // next ▶ resume from the previous run's position.
    const playing = timelineReducer(start(), { type: "play", from: 420 }, CTX);
    expect(playing.playFrom).toBe(420);
    expect(timelineReducer(playing, { type: "pause" }, CTX).playFrom).toBe(null);
  });
});

describe("purity", () => {
  it("never mutates the state it is given", () => {
    const base = start();
    const snapshot = JSON.stringify({ ...base, expandedLanes: [...base.expandedLanes] });
    timelineReducer(base, { type: "zoomBy", factor: 2 }, CTX);
    timelineReducer(base, { type: "setRegion", span: { start: 1, end: 2 } }, CTX);
    timelineReducer(base, { type: "toggleLane", key: typeLaneKey("X") }, CTX);
    expect(JSON.stringify({ ...base, expandedLanes: [...base.expandedLanes] })).toBe(snapshot);
  });
});
