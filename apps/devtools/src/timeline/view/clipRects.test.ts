import { describe, expect, it } from "vite-plus/test";
import type { RenderId, ComponentId } from "@reactlens/protocol";
import type { LaneKey } from "../../laneFilter.js";
import type { Clip, Lane } from "../model/lanes.js";
import type { LayoutRow, LaneLayout } from "../model/rows.js";
import { LANE_PAD, MIN_CLIP_PX, ROW_H, RULER_H } from "./metrics.js";
import { computeClipRects } from "./clipRects.js";

const NAME_W = 100;
const STAGE_W = 500;

function clip(id: number, t0: number, t1: number, row = 0, self = 1): Clip {
  return {
    renderId: id as RenderId,
    componentId: 1 as ComponentId,
    laneKey: "t:Comp" as LaneKey,
    name: "Comp",
    t0,
    t1,
    self,
    total: t1 - t0,
    cause: "props",
    wasted: false,
    row,
  };
}

function layoutWith(
  rows: Array<Partial<LayoutRow> & Pick<LayoutRow, "clips" | "mode">>,
): LaneLayout {
  let y = RULER_H;
  const built = rows.map((r) => {
    const h = r.mode === "wave" ? 44 : LANE_PAD + (r.depth ?? 1) * ROW_H;
    const lane: Lane = {
      key: "t:Comp" as LaneKey,
      name: "Comp",
      instanceCount: 1,
      clips: [...r.clips],
      renders: r.clips.length,
      wasted: 0,
      selfTotal: 0,
      firstT: r.clips[0]?.t0 ?? 0,
    };
    const row: LayoutRow = {
      lane,
      key: lane.key,
      y,
      h,
      mode: r.mode,
      depth: r.depth ?? 1,
      clips: r.clips,
      quiet: false,
      dim: false,
    };
    y += h;
    return row;
  });
  return {
    rows: built,
    totalH: y,
    quietLanes: [],
    quietSummary: { lanes: 0, renders: 0, selfMs: 0 },
  };
}

// 1 wall ms = 1 px, origin at nameW.
const proj = {
  aToX: (a: number) => NAME_W + a,
  wToX: (t: number) => NAME_W + t,
  nameW: NAME_W,
  stageW: STAGE_W,
  pxPerMs: 1,
};

describe("computeClipRects", () => {
  it("registers ports for stack clips fully left of the name gutter", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(1, -200, -150)] }]);
    const { clipRects } = computeClipRects(layout, proj);
    const r = clipRects.get("1");
    expect(r).toBeDefined();
    expect(r!.x0).toBe(proj.wToX(-200));
    expect(r!.x1).toBe(proj.wToX(-150));
  });

  it("registers ports for stack clips fully right of the stage", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(2, 900, 960)] }]);
    const { clipRects } = computeClipRects(layout, proj);
    expect(clipRects.get("2")).toBeDefined();
  });

  it("matches the painted stack geometry for visible clips", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(3, 50, 51, 0)] }]);
    const { clipRects } = computeClipRects(layout, proj);
    const r = clipRects.get("3")!;
    // Width floors at MIN_CLIP_PX, matching what drawBase paints.
    expect(r.x1 - r.x0).toBe(MIN_CLIP_PX);
    expect(r.y0).toBe(RULER_H + LANE_PAD / 2 + 1.5);
    expect(r.y1 - r.y0).toBe(ROW_H - 6);
  });

  it("registers wave stand-in ports for off-screen wave clips", () => {
    const layout = layoutWith([{ mode: "wave", clips: [clip(4, -300, -290, 0, 10)] }]);
    const { clipRects } = computeClipRects(layout, proj);
    const r = clipRects.get("4");
    expect(r).toBeDefined();
    expect(r!.wave).toBe(true);
    const mid = proj.wToX(-295);
    expect(r!.x0).toBe(mid - 3);
    expect(r!.x1).toBe(mid + 3);
  });

  it("centers wave ports on the painted self span, not the inclusive span", () => {
    // waveBins paints [t0, t0 + self]; a parent whose total covers its cascade
    // must not get a port floating in the middle of the invisible tail.
    const layout = layoutWith([{ mode: "wave", clips: [clip(7, 100, 200, 0, 10)] }]);
    const { clipRects } = computeClipRects(layout, proj);
    const r = clipRects.get("7")!;
    const mid = proj.wToX(105);
    expect(r.x0).toBe(mid - 3);
    expect(r.x1).toBe(mid + 3);
  });

  it("collects snap edges for every clip, on-screen or not", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(5, -200, -150), clip(6, 50, 80)] }]);
    const { snapEdges } = computeClipRects(layout, proj);
    expect(snapEdges).toEqual([-200, -150, 50, 80]);
  });
});
