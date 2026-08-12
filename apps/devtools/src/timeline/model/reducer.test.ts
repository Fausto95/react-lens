import { describe, expect, it } from "vite-plus/test";
import { buildAxis } from "./axis.js";
import { initialTimelineState, timelineReducer, type TimelineContext } from "./reducer.js";

const AXIS = buildAxis([
  [0, 1000],
  [3000, 4000],
]);
const CTX: TimelineContext = {
  bounds: { t0: 0, t1: 4000 },
  axis: AXIS,
};

const start = (over: Parameters<typeof initialTimelineState>[0] = {}) =>
  timelineReducer(
    initialTimelineState({ view: { a0: 0, a1: AXIS.total }, width: 800, ...over }),
    { type: "measure", width: 800 },
    CTX,
  );

describe("timelineReducer — view", () => {
  it("fits the whole axis", () => {
    const s = timelineReducer(start(), { type: "fit" }, CTX);
    expect(s.view.a0).toBe(0);
    expect(s.view.a1).toBeCloseTo(AXIS.total, 5);
  });

  it("zooms in around an anchor", () => {
    const base = start();
    const mid = (base.view.a0 + base.view.a1) / 2;
    const s = timelineReducer(base, { type: "zoomBy", factor: 0.5, anchorA: mid }, CTX);
    expect(s.view.a1 - s.view.a0).toBeLessThan(base.view.a1 - base.view.a0);
  });

  it("pans without changing span", () => {
    const base = timelineReducer(start(), { type: "zoomBy", factor: 0.4, anchorA: 100 }, CTX);
    const span = base.view.a1 - base.view.a0;
    const s = timelineReducer(base, { type: "panBy", dA: 40 }, CTX);
    expect(s.view.a1 - s.view.a0).toBeCloseTo(span, 5);
    expect(s.view.a0).toBeGreaterThan(base.view.a0);
  });
});

describe("timelineReducer — region / play / gaps", () => {
  it("normalises a backwards region", () => {
    const s = timelineReducer(start(), { type: "setRegion", span: { start: 200, end: 100 } }, CTX);
    expect(s.region).toEqual({ start: 100, end: 200 });
  });

  it("clears the region", () => {
    const withR = timelineReducer(
      start(),
      { type: "setRegion", span: { start: 10, end: 20 } },
      CTX,
    );
    expect(timelineReducer(withR, { type: "setRegion", span: null }, CTX).region).toBeNull();
  });

  it("plays and pauses", () => {
    const playing = timelineReducer(start(), { type: "play", dir: -1, speed: 2 }, CTX);
    expect(playing.playing).toBe(true);
    expect(playing.playDir).toBe(-1);
    expect(playing.speed).toBe(2);
    expect(timelineReducer(playing, { type: "pause" }, CTX).playing).toBe(false);
  });

  it("clears a selected clip", () => {
    const withClip = timelineReducer(
      start(),
      { type: "selectClip", renderId: 7 as never, laneKey: "t:App" },
      CTX,
    );
    expect(withClip.selectedRender).toBe(7);
    expect(timelineReducer(withClip, { type: "clearClip" }, CTX).selectedRender).toBeNull();
  });

  it("toggles gap expansion targets", () => {
    const s = timelineReducer(start(), { type: "toggleGap", id: "g1" }, CTX);
    expect(s.expandedGaps.has("g1")).toBe(true);
    expect(timelineReducer(s, { type: "toggleGap", id: "g1" }, CTX).expandedGaps.has("g1")).toBe(
      false,
    );
  });

  it("toggles shelf and help", () => {
    const s = timelineReducer(start(), { type: "toggleShelf" }, CTX);
    expect(s.shelfOpen).toBe(true);
    expect(timelineReducer(s, { type: "toggleHelp" }, CTX).showHelp).toBe(true);
  });
});
