import { describe, it, expect } from "vitest";
import { aggregateBars, visibleChunkRange, type ClusterBar } from "./lod.js";
import type { PackedBar } from "./pack.js";
import type { ComponentId, RenderId } from "@react-lens/protocol";

let seq = 0;
function bar(over: Partial<PackedBar>): PackedBar {
  seq++;
  return {
    id: seq as ComponentId,
    renderId: seq as RenderId,
    name: `C${seq}`,
    phaseId: "p1",
    phaseLabel: "click",
    t0: 0,
    t1: 1,
    self: 1,
    heat: 0.5,
    reason: "state",
    track: 0,
    left: 0,
    width: 1,
    labelRoom: Infinity,
    ...over,
  };
}

describe("aggregateBars", () => {
  it("merges adjacent sub-threshold neighbors on the same track", () => {
    const bars = [
      bar({ left: 0, width: 1, t0: 0, t1: 1, self: 2 }),
      bar({ left: 1.5, width: 1, t0: 10, t1: 11, self: 3 }),
      bar({ left: 3, width: 1, t0: 20, t1: 21, self: 1 }),
    ];
    const { singles, clusters } = aggregateBars(bars, 2);
    expect(singles).toHaveLength(0);
    expect(clusters).toHaveLength(1);
    const c = clusters[0]!;
    expect(c.count).toBe(3);
    expect(c.self).toBeCloseTo(6);
    expect(c.t0).toBe(0);
    expect(c.t1).toBe(21);
    expect(c.left).toBe(0);
    expect(c.width).toBeCloseTo(4);
  });

  it("keeps wide bars and distant narrow bars as singles", () => {
    const bars = [
      bar({ left: 0, width: 40, self: 5 }),
      bar({ left: 100, width: 1 }), // narrow but isolated
      bar({ left: 200, width: 1 }),
    ];
    const { singles, clusters } = aggregateBars(bars, 2);
    expect(clusters).toHaveLength(0);
    expect(singles).toHaveLength(3);
  });

  it("never merges across tracks or phases", () => {
    const bars = [
      bar({ left: 0, width: 1, track: 0 }),
      bar({ left: 1, width: 1, track: 1 }),
      bar({ left: 2, width: 1, track: 0, phaseId: "p2" }),
    ];
    const { singles, clusters } = aggregateBars(bars, 2);
    expect(clusters).toHaveLength(0);
    expect(singles).toHaveLength(3);
  });

  it("preserves total count and self time across the split", () => {
    const bars = Array.from({ length: 30 }, (_, i) =>
      bar({ left: i * (i % 3 === 0 ? 50 : 1.2), width: i % 5 === 0 ? 30 : 1, self: 1 + (i % 4) }),
    );
    const { singles, clusters } = aggregateBars(bars, 2);
    const total = singles.length + clusters.reduce((s, c: ClusterBar) => s + c.count, 0);
    expect(total).toBe(bars.length);
    const selfSum =
      singles.reduce((s, b) => s + b.self, 0) + clusters.reduce((s, c) => s + c.self, 0);
    expect(selfSum).toBeCloseTo(bars.reduce((s, b) => s + b.self, 0));
  });
});

describe("visibleChunkRange", () => {
  it("covers the viewport plus one chunk of overscan", () => {
    const r = visibleChunkRange(1000, 800, 512);
    expect(r.c0).toBe(0); // floor(1000/512)=1, minus overscan
    expect(r.c1).toBe(4); // floor(1800/512)=3, plus overscan
    expect(r.x0).toBe(0);
    expect(r.x1).toBe(5 * 512);
  });

  it("clamps at the left edge", () => {
    const r = visibleChunkRange(0, 640, 512);
    expect(r.c0).toBe(0);
    expect(r.x0).toBe(0);
  });

  it("changes only when scrolling crosses a chunk boundary", () => {
    const a = visibleChunkRange(100, 800, 512);
    const b = visibleChunkRange(120, 800, 512); // both edges stay in-chunk
    expect(a).toEqual(b);
    const c = visibleChunkRange(700, 800, 512);
    expect(c).not.toEqual(a);
  });
});
