import { describe, expect, it } from "vite-plus/test";
import {
  INSP_MAX,
  INSP_MIN,
  NONE_COLLAPSED,
  RAIL_W,
  TIMELINE_MIN,
  columnTemplate,
  fitColumns,
  nextColumnWidth,
} from "./columns.js";

describe("columnTemplate", () => {
  it("gives the cascade the slack and the inspector its width", () => {
    expect(columnTemplate(320)).toBe("minmax(0, 1fr) 320px");
  });

  it("reduces a collapsed inspector to a rail", () => {
    expect(columnTemplate(320, { inspector: true })).toBe(`minmax(0, 1fr) ${RAIL_W}px`);
  });
});

describe("fitColumns", () => {
  it("leaves the stored width alone when it fits", () => {
    expect(fitColumns(1200, 320, NONE_COLLAPSED)).toEqual({ inspW: 320 });
  });

  it("leaves it alone when the grid has not been measured yet", () => {
    expect(fitColumns(0, 320)).toEqual({ inspW: 320 });
  });

  it("squeezes the inspector rather than the cascade in a narrow dock", () => {
    const { inspW } = fitColumns(500, 420);
    expect(inspW).toBeLessThan(420);
    expect(500 - inspW).toBeGreaterThan(0);
  });

  it("never squeezes a collapsed inspector — it is already a rail", () => {
    expect(fitColumns(300, 420, { inspector: true })).toEqual({ inspW: 420 });
  });
});

describe("nextColumnWidth", () => {
  it("follows the pointer inside the pane's range", () => {
    expect(nextColumnWidth(400, { total: 1400, inspW: 320 })).toBe(400);
  });

  it("clamps to the pane's minimum", () => {
    expect(nextColumnWidth(10, { total: 1400, inspW: 320 })).toBe(INSP_MIN);
  });

  it("clamps to the pane's maximum", () => {
    expect(nextColumnWidth(5000, { total: 4000, inspW: 320 })).toBe(INSP_MAX);
  });

  it("never starves the cascade below its minimum", () => {
    const total = INSP_MIN + TIMELINE_MIN + 40;
    const next = nextColumnWidth(9999, { total, inspW: 320 });
    expect(total - next).toBeGreaterThanOrEqual(TIMELINE_MIN);
  });

  it("still honours the minimum when the dock is smaller than both minima", () => {
    expect(nextColumnWidth(9999, { total: 100, inspW: 320 })).toBe(INSP_MIN);
  });
});
