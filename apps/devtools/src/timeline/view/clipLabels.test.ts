import { describe, expect, it } from "vite-plus/test";
import type { Clip } from "../model/lanes.js";
import { labelForClip, reserveLabelSpan } from "./clipLabels.js";

const clip = {
  renderId: 1,
  componentId: 1,
  laneKey: "t:A",
  name: "A",
  t0: 10,
  t1: 11.8,
  self: 0.6,
  total: 1.8,
  cause: "state",
  wasted: false,
  row: 0,
} as unknown as Clip;

describe("clip labels", () => {
  it("progressively reveals information", () => {
    expect(labelForClip(10, clip)).toBeNull();
    expect(labelForClip(20, clip)).toBe("S");
    expect(labelForClip(40, clip)).toBe("state");
    expect(labelForClip(90, clip)).toBe("state · 1.8ms");
  });

  it("rejects colliding labels", () => {
    const spans = [{ left: 10, right: 30 }];
    expect(reserveLabelSpan(spans, 32, 50)).toBe(false);
    expect(reserveLabelSpan(spans, 40, 55)).toBe(true);
  });
});
