import { describe, expect, it } from "vite-plus/test";
import {
  causalBezierPoints,
  cubicTangent,
  planCausalArrows,
  routeCausalArrow,
  tangentAngle,
} from "./arrows.js";

describe("causalBezierPoints", () => {
  it("pulls control points horizontally for forward arrows", () => {
    const [p0, p1, , p3] = causalBezierPoints(10, 20, 200, 80, "forward");
    expect(p0).toEqual({ x: 10, y: 20 });
    expect(p3).toEqual({ x: 200, y: 80 });
    expect(p1.x).toBeGreaterThan(p0.x);
    expect(p1.y).toBe(p0.y);
  });

  it("bows left for left-side stacked arrows", () => {
    const [, p1, p2] = causalBezierPoints(40, 20, 40, 100, "left");
    expect(p1.x).toBeLessThan(40);
    expect(p2.x).toBeLessThan(40);
  });

  it("spreads later fan slots further outward", () => {
    const [, a] = causalBezierPoints(200, 20, 200, 100, "right", 0);
    const [, b] = causalBezierPoints(200, 20, 200, 100, "right", 36);
    expect(b.x - 200).toBeGreaterThan(a.x - 200);
  });

  it("handles backward-in-time endpoints", () => {
    const [, p1, p2] = causalBezierPoints(200, 40, 50, 60, "forward");
    expect(p1.x).toBeLessThan(200);
    expect(p2.x).toBeGreaterThan(50);
  });
});

describe("routeCausalArrow", () => {
  const parent = { x0: 100, x1: 220, y0: 40, y1: 58 };
  const child = { x0: 110, x1: 180, y0: 70, y1: 88 };
  const later = { x0: 250, x1: 320, y0: 70, y1: 88 };

  it("uses left-side routing for a single downward child", () => {
    const r = routeCausalArrow(parent, child);
    expect(r.side).toBe("left");
    expect(r.x1).toBeCloseTo(parent.x0 + 2);
    expect(r.x2).toBeCloseTo(child.x0 + 2);
  });

  it("fans multiple downward effects out the right side", () => {
    const r = routeCausalArrow(parent, child, 2, 4);
    expect(r.side).toBe("right");
    expect(r.x1).toBeCloseTo(parent.x1 - 2);
    expect(r.fanSpread).toBeGreaterThan(0);
  });

  it("uses right-side routing when going back up the stack", () => {
    const r = routeCausalArrow(child, parent);
    expect(r.side).toBe("right");
    expect(r.x1).toBeCloseTo(child.x1 - 2);
    expect(r.x2).toBeCloseTo(parent.x1 - 2);
  });

  it("uses forward right→left when the target is clearly later", () => {
    const r = routeCausalArrow(parent, later);
    expect(r.side).toBe("forward");
    expect(r.x1).toBeCloseTo(parent.x1 - 2);
    expect(r.x2).toBeCloseTo(later.x0 + 2);
  });

  it("spreads fan ports along the source edge", () => {
    const a = routeCausalArrow(parent, child, 1, 3);
    const b = routeCausalArrow(parent, child, 3, 3);
    expect(b.y1).toBeGreaterThan(a.y1);
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
    expect(planned.map((p) => p.slot).sort()).toEqual([1, 2]);
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
    expect(planned.map((p) => p.slot).sort()).toEqual([1, 2]);
    expect(planned.every((p) => p.slotCount === 2)).toBe(true);
    expect(planned.find((p) => p.waveCount != null)?.waveCount).toBe(2);
    expect(planned.find((p) => p.to.t0 === 20)?.order).toBe(1);
    expect(planned.find((p) => p.waveCount != null)?.order).toBe(2);
  });
});

describe("arrowhead alignment", () => {
  it("tangent at the tip points toward the target", () => {
    const pts = causalBezierPoints(0, 0, 160, 40, "forward");
    const tan = cubicTangent(0.995, ...pts);
    const angle = tangentAngle(tan);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(Math.PI / 2);
  });
});
