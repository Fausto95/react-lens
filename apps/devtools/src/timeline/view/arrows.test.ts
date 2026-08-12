import { describe, expect, it } from "vite-plus/test";
import {
  causalBezierPoints,
  cubicTangent,
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

describe("arrowhead alignment", () => {
  it("tangent at the tip points toward the target", () => {
    const pts = causalBezierPoints(0, 0, 160, 40, "forward");
    const tan = cubicTangent(0.995, ...pts);
    const angle = tangentAngle(tan);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(Math.PI / 2);
  });
});
