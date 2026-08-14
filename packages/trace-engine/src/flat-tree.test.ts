import { describe, it, expect } from "vite-plus/test";
import { FlatTreeIndex, TreeFlags } from "./flat-tree.js";

describe("FlatTreeIndex", () => {
  it("queryWindow returns only overscan-visible rows", () => {
    const tree = new FlatTreeIndex();
    tree.upsert({ id: 1, name: "App", renders: 1, selfTime: 1, compiled: true });
    for (let i = 2; i <= 200; i++) {
      tree.upsert({
        id: i,
        parentId: 1,
        name: `Row${i}`,
        renders: 1,
        selfTime: 0.1,
        compiled: true,
      });
    }
    tree.rebuildOrder();
    const expanded = new Set(["c:1"]);
    const { rows, totalRows } = tree.queryWindow({
      expanded,
      scrollTop: 26 * 50,
      viewH: 26 * 10,
      rowHeight: 26,
      overscan: 2,
    });
    expect(totalRows).toBeGreaterThanOrEqual(200);
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(rows[0]!.index).toBeGreaterThanOrEqual(40);
  });

  it("stores last-observable flags without why()", () => {
    const tree = new FlatTreeIndex();
    tree.upsert({ id: 1, name: "A", renders: 3, selfTime: 1, compiled: false });
    tree.setLastObservable(1, false);
    expect(tree.lastObservable(1)).toBe(false);
    expect(tree.flags[tree.indexOf(1)]! & TreeFlags.WastedLast).toBeTruthy();
  });
});
