import { describe, expect, it } from "vite-plus/test";
import type { Interaction } from "@reactlens/trace-engine";
import { RAIL_SORTS, buildRailRows, railSortOrder, type RailSortKey } from "./interactionRail.js";

function interaction(
  id: string,
  label: string,
  start: number,
  reactDuration: number,
  renderCount = 1,
  extra: Partial<Interaction["metrics"]> = {},
): Interaction {
  return {
    id,
    label,
    kind: "click",
    start,
    end: start + reactDuration,
    renderIds: [],
    commitIds: [],
    metrics: {
      totalDuration: reactDuration,
      reactDuration,
      renderCount,
      stateUpdates: 1,
      componentIds: [],
      ...extra,
    },
  } as unknown as Interaction;
}

const SESSION = [
  interaction("a", "Load", 0, 336, 2338),
  interaction("b", "click Continue", 1000, 51.2, 138),
  interaction("c", "input Search", 2000, 2.1, 6),
  interaction("d", "scroll Catalog", 3000, 18.3, 412),
];

const WASTE = new Map([
  ["d", 380],
  ["b", 96],
]);

describe("railSortOrder", () => {
  it("reads the session forwards by default", () => {
    expect(railSortOrder(SESSION, WASTE, "time").map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("ranks by React time when sorting by cost", () => {
    expect(railSortOrder(SESSION, WASTE, "slowest").map((i) => i.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("ranks by wasted renders, falling back to cost", () => {
    const order = railSortOrder(SESSION, WASTE, "wasted").map((i) => i.id);
    expect(order.slice(0, 2)).toEqual(["d", "b"]);
    // Neither of the remaining two wasted anything, so cost decides.
    expect(order.slice(2)).toEqual(["a", "c"]);
  });

  it("never mutates the caller's list", () => {
    const input = [...SESSION];
    railSortOrder(input, WASTE, "slowest");
    expect(input.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("breaks a ranked tie by recency — the newest equal is the one you just caused", () => {
    const tied = [interaction("x", "A", 10, 5), interaction("y", "B", 20, 5)];
    expect(railSortOrder(tied, new Map(), "slowest").map((i) => i.id)).toEqual(["y", "x"]);
  });

  it("offers a label for every sort it supports", () => {
    for (const key of Object.keys(RAIL_SORTS) as RailSortKey[]) {
      expect(RAIL_SORTS[key].label.length).toBeGreaterThan(0);
    }
  });
});

describe("buildRailRows", () => {
  it("scales the cost fill against the most expensive interaction in view", () => {
    const rows = buildRailRows(SESSION, WASTE, "time");
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("a")!.costShare).toBeCloseTo(1);
    expect(byId.get("b")!.costShare).toBeCloseTo(51.2 / 336);
  });

  it("flags the interactions worth looking at as hot", () => {
    const rows = buildRailRows(SESSION, WASTE, "time");
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("a")!.hot).toBe(true);
    expect(byId.get("c")!.hot).toBe(false);
  });

  it("carries the wasted count through so the row can warn", () => {
    const rows = buildRailRows(SESSION, WASTE, "time");
    expect(rows.find((row) => row.id === "d")!.wasted).toBe(380);
    expect(rows.find((row) => row.id === "a")!.wasted).toBe(0);
  });

  it("puts the numbers the row no longer shows into one tooltip", () => {
    const rows = buildRailRows(SESSION, WASTE, "time");
    const tip = rows.find((row) => row.id === "d")!.detail;
    expect(tip).toContain("412 renders");
    expect(tip).toContain("380 wasted");
  });

  it("survives a session where nothing cost anything", () => {
    const flat = [interaction("z", "idle", 0, 0, 0)];
    const rows = buildRailRows(flat, new Map(), "time");
    expect(rows[0]!.costShare).toBe(0);
    expect(rows[0]!.hot).toBe(false);
  });

  it("returns no rows for an empty session", () => {
    expect(buildRailRows([], new Map(), "time")).toEqual([]);
  });
});
