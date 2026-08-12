import { describe, it, expect } from "vite-plus/test";
import { rowWindow, OVERSCAN } from "./rowWindow.js";

const H = 26;

describe("rowWindow", () => {
  it("covers the viewport at the top of the list", () => {
    const w = rowWindow({ count: 1000, rowHeight: H, scrollTop: 0, viewport: 260 });
    expect(w.start).toBe(0);
    // 10 rows fit; the rest is overscan.
    expect(w.end).toBeGreaterThanOrEqual(10);
    expect(w.end).toBeLessThanOrEqual(10 + OVERSCAN + 1);
  });

  it("follows the scroll offset", () => {
    const w = rowWindow({ count: 1000, rowHeight: H, scrollTop: 400, viewport: 260 });
    // 400/26 = row 15, less overscan.
    expect(w.start).toBe(15 - OVERSCAN);
    expect(w.end).toBeGreaterThan(w.start + 10);
  });

  it("mounts a fraction of a large list — the whole point", () => {
    const w = rowWindow({ count: 10_000, rowHeight: H, scrollTop: 5_000, viewport: 600 });
    expect(w.end - w.start).toBeLessThan(60);
  });

  it("never runs past either end", () => {
    const top = rowWindow({ count: 40, rowHeight: H, scrollTop: 0, viewport: 260 });
    expect(top.start).toBe(0);
    const bottom = rowWindow({ count: 40, rowHeight: H, scrollTop: 99_999, viewport: 260 });
    expect(bottom.end).toBe(40);
    expect(bottom.start).toBeLessThanOrEqual(40);
  });

  it("handles a list shorter than the viewport", () => {
    const w = rowWindow({ count: 3, rowHeight: H, scrollTop: 0, viewport: 600 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(3);
  });

  it("handles an empty list", () => {
    expect(rowWindow({ count: 0, rowHeight: H, scrollTop: 0, viewport: 600 })).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 0,
    });
  });

  it("offsets the mounted rows so they sit where they belong", () => {
    const w = rowWindow({ count: 1000, rowHeight: H, scrollTop: 400, viewport: 260 });
    expect(w.offsetTop).toBe(w.start * H);
    expect(w.totalHeight).toBe(1000 * H);
  });

  it("subtracts content sitting above the list in the same scroller", () => {
    // The watchlist shares the tree's scroller, so the list's own scroll
    // position lags the scroller's by that height.
    const w = rowWindow({
      count: 1000,
      rowHeight: H,
      scrollTop: 400,
      viewport: 260,
      scrollMargin: 140,
    });
    expect(w.start).toBe(Math.max(0, Math.floor((400 - 140) / H) - OVERSCAN));
  });

  it("is stable for scrolls within one row", () => {
    // Otherwise every pixel of scroll re-renders the whole tree.
    const a = rowWindow({ count: 1000, rowHeight: H, scrollTop: 400, viewport: 260 });
    const b = rowWindow({ count: 1000, rowHeight: H, scrollTop: 410, viewport: 260 });
    expect(b).toEqual(a);
  });
});
