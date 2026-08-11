import { describe, it, expect } from "vite-plus/test";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import type { Clip } from "./lanes.js";
import { placeClips, MIN_CLIP_PX, CLUSTER_GAP_PX } from "./place.js";

const clip = (id: number, t0: number, t1: number): Clip => ({
  renderId: id as RenderId,
  componentId: 1 as ComponentId,
  laneKey: "I18n",
  name: "I18n",
  t0,
  t1,
  self: t1 - t0,
  cause: "state",
  wasted: false,
});

/** 1px per ms — so a time is its own x, and the arithmetic stays readable. */
const xOf = (t: number) => t;

describe("placeClips", () => {
  it("leaves well-separated clips alone", () => {
    const placed = placeClips([clip(1, 0, 20), clip(2, 100, 130)], xOf);
    expect(placed).toHaveLength(2);
    expect(placed.every((p) => p.kind === "clip")).toBe(true);
    expect(placed[0]).toMatchObject({ left: 0, width: 20 });
    expect(placed[1]).toMatchObject({ left: 100, width: 30 });
  });

  it("applies the legibility floor to a sub-pixel render", () => {
    const [only] = placeClips([clip(1, 10, 10.2)], xOf);
    expect(only!.width).toBe(MIN_CLIP_PX);
  });

  it("clusters clips whose floored boxes would overlap", () => {
    // The reported defect: four renders microseconds apart each got a 4px
    // floor and drew on top of each other, unreadable and unclickable.
    const clips = [
      clip(1, 10, 10.1),
      clip(2, 10.2, 10.3),
      clip(3, 10.4, 10.5),
      clip(4, 10.6, 10.7),
    ];
    const placed = placeClips(clips, xOf);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.kind).toBe("cluster");
    expect(placed[0]!.clips).toHaveLength(4);
  });

  it("gives a cluster a box that covers everything inside it", () => {
    const clips = [clip(1, 10, 10.1), clip(2, 10.2, 10.3), clip(3, 10.4, 10.5)];
    const [c] = placeClips(clips, xOf);
    expect(c!.left).toBe(10);
    expect(c!.width).toBeGreaterThanOrEqual(MIN_CLIP_PX);
    // Every clustered clip's own span falls inside the drawn box.
    for (const inner of c!.clips) {
      expect(xOf(inner.t0)).toBeGreaterThanOrEqual(c!.left);
      expect(xOf(inner.t1)).toBeLessThanOrEqual(c!.left + c!.width);
    }
  });

  it("never overlaps what it draws", () => {
    const clips = [
      clip(1, 0, 0.1),
      clip(2, 0.2, 0.3),
      clip(3, 40, 60),
      clip(4, 61, 61.1),
      clip(5, 61.2, 61.3),
      clip(6, 200, 240),
    ];
    const placed = placeClips(clips, xOf);
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1]!;
      expect(placed[i]!.left).toBeGreaterThanOrEqual(prev.left + prev.width);
    }
  });

  it("splits a cluster apart as the scale grows", () => {
    // Zooming in is the way out of a cluster, so the same clips must resolve
    // into separate boxes once there is room for them.
    const clips = [clip(1, 10, 10.1), clip(2, 10.4, 10.5), clip(3, 10.8, 10.9)];
    expect(placeClips(clips, xOf)).toHaveLength(1);
    const zoomed = placeClips(clips, (t) => t * 500);
    expect(zoomed).toHaveLength(3);
    expect(zoomed.every((p) => p.kind === "clip")).toBe(true);
  });

  it("keeps a lone clip a clip, never a cluster of one", () => {
    const placed = placeClips([clip(1, 10, 10.1), clip(2, 500, 520)], xOf);
    expect(placed.map((p) => p.kind)).toEqual(["clip", "clip"]);
  });

  it("orders by time even when the input is not sorted", () => {
    const placed = placeClips([clip(2, 300, 320), clip(1, 10, 30)], xOf);
    expect(placed.map((p) => p.left)).toEqual([10, 300]);
  });

  it("respects the breathing room between neighbours", () => {
    // Touching boxes read as one long clip; the gap is what makes four
    // renders countable at a glance.
    const clips = [clip(1, 0, 10), clip(2, 10 + CLUSTER_GAP_PX / 2, 20)];
    expect(placeClips(clips, xOf)).toHaveLength(1);
  });

  it("survives an empty lane", () => {
    expect(placeClips([], xOf)).toEqual([]);
  });
});
