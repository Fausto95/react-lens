import { describe, expect, it } from "vite-plus/test";
import type { RenderId, ComponentId } from "@reactlens/protocol";
import type { LaneKey } from "../../laneFilter.js";
import type { Clip, Lane } from "../model/lanes.js";
import type { LayoutRow, LaneLayout } from "../model/rows.js";
import { LANE_PAD, MIN_HIT_TARGET_PX, ROW_H, RULER_H } from "./metrics.js";
import { computeClipRects } from "./clipRects.js";
import { hitTestClipRects } from "./hitTest.js";

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

function layoutWith(rows: Array<Partial<LayoutRow> & Pick<LayoutRow, "clips" | "mode">>): LaneLayout {
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
  return { rows: built, totalH: y, quietLanes: [], quietSummary: { lanes: 0, renders: 0, selfMs: 0 } };
}

const proj = {
  aToX: (a: number) => NAME_W + a,
  wToX: (t: number) => NAME_W + t,
  nameW: NAME_W,
  stageW: STAGE_W,
  pxPerMs: 1,
};

describe("computeClipRects", () => {
  it("registers ports for off-screen stack clips", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(1, -200, -150), clip(2, 900, 960)] }]);
    const { clipRects } = computeClipRects(layout, proj);
    expect(clipRects.get("1")!.x0).toBe(proj.wToX(-200));
    expect(clipRects.get("2")).toBeDefined();
  });

  it("keeps a 1px event visually truthful but gives it a usable hit target", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(3, 50, 51, 0)] }]);
    const r = computeClipRects(layout, proj).clipRects.get("3")!;
    expect(r.representation).toBe("tick");
    expect(r.visual.width).toBe(1);
    expect(r.hit.width).toBeGreaterThanOrEqual(MIN_HIT_TARGET_PX);
    expect(r.y0).toBe(RULER_H + LANE_PAD / 2 + 1.5);
    expect(r.y1 - r.y0).toBe(ROW_H - 6);
  });

  it("uses clip representation for visibly wide events", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(8, 50, 55)] }]);
    const r = computeClipRects(layout, proj).clipRects.get("8")!;
    expect(r.representation).toBe("clip");
    expect(r.visual.width).toBe(5);
  });

  it("registers wave stand-ins with expanded hit geometry", () => {
    const layout = layoutWith([{ mode: "wave", clips: [clip(4, -300, -290, 0, 10)] }]);
    const r = computeClipRects(layout, proj).clipRects.get("4")!;
    expect(r.wave).toBe(true);
    expect(r.representation).toBe("wave");
    expect(r.hit.width).toBeGreaterThanOrEqual(MIN_HIT_TARGET_PX);
  });

  it("collects snap edges for every clip", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(5, -200, -150), clip(6, 50, 80)] }]);
    expect(computeClipRects(layout, proj).snapEdges).toEqual([-200, -150, 50, 80]);
  });

  it("prefers painted geometry over a neighboring expanded hit target", () => {
    const layout = layoutWith([{ mode: "stack", clips: [clip(10, 50, 50.5), clip(11, 52, 58)] }]);
    const { clipRects } = computeClipRects(layout, proj);
    const b = clipRects.get("11")!;
    const hit = hitTestClipRects(
      { x: b.visual.x + 1, y: b.visual.y + b.visual.height / 2 },
      clipRects.values(),
    );
    expect(hit?.clip.renderId).toBe(11);
  });
});
