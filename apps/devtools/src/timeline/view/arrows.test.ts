import { describe, expect, it } from "vite-plus/test";
import { causalBezierPoints, cubicTangent, tangentAngle } from "./arrows.js";

describe("causalBezierPoints", () => {
  it("pulls control points horizontally for cross-lane arrows", () => {
    const [p0, p1, , p3] = causalBezierPoints(10, 20, 200, 80);
    expect(p0).toEqual({ x: 10, y: 20 });
    expect(p3).toEqual({ x: 200, y: 80 });
    expect(p1.x).toBeGreaterThan(p0.x);
    expect(p1.y).toBe(p0.y);
  });

  it("handles backward-in-time endpoints", () => {
    const [, p1, p2] = causalBezierPoints(200, 40, 50, 60);
    expect(p1.x).toBeLessThan(200);
    expect(p2.x).toBeGreaterThan(50);
  });
});

describe("arrowhead alignment", () => {
  it("tangent at the tip points toward the target", () => {
    const pts = causalBezierPoints(0, 0, 160, 40);
    const tan = cubicTangent(0.995, ...pts);
    const angle = tangentAngle(tan);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(Math.PI / 2);
  });
});
