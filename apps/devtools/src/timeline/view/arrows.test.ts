import { describe, expect, it } from "vite-plus/test";
import { arrowSpanVisible, planCausalArrows, routeCausalArrow } from "./arrows.js";

describe("routeCausalArrow", () => {
  const parent = { x0: 100, x1: 220, y0: 40, y1: 58 };
  const child = { x0: 110, x1: 180, y0: 70, y1: 88 };
  const later = { x0: 250, x1: 320, y0: 70, y1: 88 };

  it("uses left-bus routing for a single downward child", () => {
    const r = routeCausalArrow(parent, child);
    expect(r.side).toBe("left");
    expect(r.busX).toBe(parent.x0);
    expect(r.x1).toBe(parent.x0);
    expect(r.x2).toBe(child.x0);
    expect(r.y2).toBeCloseTo((child.y0 + child.y1) / 2);
  });

  it("keeps fan-out on the shared left bus", () => {
    const a = routeCausalArrow(parent, child, 1, 4);
    const b = routeCausalArrow(parent, child, 2, 4);
    expect(a.side).toBe("left");
    expect(b.side).toBe("left");
    expect(a.busX).toBe(parent.x0);
    expect(b.busX).toBe(parent.x0);
    expect(a.x2).toBe(child.x0);
    expect(b.x2).toBe(child.x0);
  });

  it("uses left-bus routing when going back up the stack", () => {
    const r = routeCausalArrow(child, parent);
    expect(r.side).toBe("left");
    expect(r.busX).toBe(child.x0);
    expect(r.x2).toBe(parent.x0);
  });

  it("uses forward right→left when the target is clearly later", () => {
    const r = routeCausalArrow(parent, later);
    expect(r.side).toBe("forward");
    expect(r.busX).toBeNull();
    expect(r.x1).toBeCloseTo(parent.x1);
    expect(r.x2).toBeCloseTo(later.x0);
  });

  it("attaches the child port at mid-height for order badges", () => {
    const r = routeCausalArrow(parent, child);
    expect(r.y2).toBeCloseTo((child.y0 + child.y1) / 2);
    expect(r.x2).toBe(child.x0);
  });
});

describe("planCausalArrows", () => {
  it("collapses many edges into one arrow aimed at a wave lane", () => {
    const ports = new Map([
      ["src", { x0: 100, x1: 180, y0: 40, y1: 56 }],
      ["a", { x0: 110, x1: 116, y0: 120, y1: 136, wave: true, laneKey: "t:Leaf" }],
      ["b", { x0: 130, x1: 136, y0: 120, y1: 136, wave: true, laneKey: "t:Leaf" }],
      ["c", { x0: 150, x1: 156, y0: 120, y1: 136, wave: true, laneKey: "t:Leaf" }],
    ]);
    const planned = planCausalArrows(
      [
        { from: "src", to: "a", causeKey: "props" },
        { from: "src", to: "b", causeKey: "props" },
        { from: "src", to: "c", causeKey: "props" },
      ],
      ports,
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]!.waveCount).toBe(3);
    expect(planned[0]!.to.wave).toBe(true);
  });

  it("keeps stack fan-outs as individual ordered arrows", () => {
    const ports = new Map([
      ["src", { x0: 100, x1: 180, y0: 40, y1: 56 }],
      ["a", { x0: 110, x1: 150, y0: 70, y1: 86 }],
      ["b", { x0: 110, x1: 150, y0: 100, y1: 116 }],
    ]);
    const planned = planCausalArrows(
      [
        { from: "src", to: "a", causeKey: "props" },
        { from: "src", to: "b", causeKey: "props" },
      ],
      ports,
    );
    expect(planned).toHaveLength(2);
    expect(planned.map((p) => p.slot).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(planned.every((p) => p.slotCount === 2)).toBe(true);
  });

  it("orders a lone arrow as slot 1", () => {
    const ports = new Map([
      ["src", { x0: 100, x1: 180, y0: 40, y1: 56, t0: 10 }],
      ["a", { x0: 110, x1: 150, y0: 70, y1: 86, t0: 20 }],
    ]);
    const planned = planCausalArrows([{ from: "src", to: "a", causeKey: "state" }], ports);
    expect(planned).toEqual([expect.objectContaining({ slot: 1, slotCount: 1, order: 1 })]);
  });

  it("numbers a chain globally by effect time, not per source", () => {
    // state → props → context: each source has one outgoing edge, so per-source
    // slots are both 1 — global order must still read 1, 2.
    const ports = new Map([
      ["state", { x0: 100, x1: 220, y0: 40, y1: 56, t0: 0 }],
      ["props", { x0: 110, x1: 180, y0: 100, y1: 116, t0: 30 }],
      ["context", { x0: 100, x1: 160, y0: 20, y1: 36, t0: 50 }],
    ]);
    const planned = planCausalArrows(
      [
        { from: "state", to: "props", causeKey: "props" },
        { from: "props", to: "context", causeKey: "context" },
      ],
      ports,
    );
    expect(planned).toHaveLength(2);
    expect(planned.find((p) => p.to.t0 === 30)?.order).toBe(1);
    expect(planned.find((p) => p.to.t0 === 50)?.order).toBe(2);
    expect(planned.every((p) => p.slot === 1 && p.slotCount === 1)).toBe(true);
  });

  it("shares fan slots across wave groups and stack children", () => {
    const ports = new Map([
      ["src", { x0: 100, x1: 180, y0: 40, y1: 56, t0: 0 }],
      ["leafA", { x0: 110, x1: 116, y0: 120, y1: 136, wave: true, laneKey: "t:Leaf", t0: 40 }],
      ["leafB", { x0: 130, x1: 136, y0: 120, y1: 136, wave: true, laneKey: "t:Leaf", t0: 42 }],
      ["child", { x0: 110, x1: 150, y0: 70, y1: 86, t0: 20 }],
    ]);
    const planned = planCausalArrows(
      [
        { from: "src", to: "leafA", causeKey: "props" },
        { from: "src", to: "leafB", causeKey: "props" },
        { from: "src", to: "child", causeKey: "state" },
      ],
      ports,
    );
    expect(planned).toHaveLength(2);
    expect(planned.map((p) => p.slot).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(planned.every((p) => p.slotCount === 2)).toBe(true);
    expect(planned.find((p) => p.waveCount != null)?.waveCount).toBe(2);
    expect(planned.find((p) => p.to.t0 === 20)?.order).toBe(1);
    expect(planned.find((p) => p.waveCount != null)?.order).toBe(2);
  });
});

describe("planCausalArrows with off-screen ports", () => {
  it("plans an edge whose source port sits far left of the stage", () => {
    const ports = new Map([
      ["src", { x0: -500, x1: -440, y0: 40, y1: 56, t0: 0 }],
      ["dst", { x0: 200, x1: 260, y0: 70, y1: 86, t0: 20 }],
    ]);
    const planned = planCausalArrows([{ from: "src", to: "dst", causeKey: "state" }], ports);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.from.x0).toBe(-500);
  });
});

describe("arrowSpanVisible", () => {
  const NW = 100;
  const W = 500;

  it("keeps an arrow whose curve crosses the viewport", () => {
    const from = { x0: -500, x1: -440, y0: 40, y1: 56 };
    const to = { x0: 200, x1: 260, y0: 70, y1: 86 };
    expect(arrowSpanVisible(from, to, NW, W)).toBe(true);
  });

  it("keeps an arrow whose ports straddle the viewport entirely", () => {
    const from = { x0: -500, x1: -440, y0: 40, y1: 56 };
    const to = { x0: 900, x1: 960, y0: 70, y1: 86 };
    expect(arrowSpanVisible(from, to, NW, W)).toBe(true);
  });

  it("culls an arrow whose ports are both far past the same edge", () => {
    const from = { x0: -900, x1: -840, y0: 40, y1: 56 };
    const to = { x0: -700, x1: -640, y0: 70, y1: 86 };
    expect(arrowSpanVisible(from, to, NW, W)).toBe(false);
  });

  it("keeps an arrow just past the edge within the stub margin", () => {
    const from = { x0: 80, x1: 95, y0: 40, y1: 56 };
    const to = { x0: 85, x1: 98, y0: 70, y1: 86 };
    expect(arrowSpanVisible(from, to, NW, W)).toBe(true);
  });
});
