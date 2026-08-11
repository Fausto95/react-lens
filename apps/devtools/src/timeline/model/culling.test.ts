import { describe, it, expect } from "vite-plus/test";
import { CHUNK_PX, inChunkRange, sameChunkRange, visibleChunkRange } from "./culling.js";

describe("visibleChunkRange", () => {
  it("covers the viewport plus one chunk of overscan on each side", () => {
    const range = visibleChunkRange(CHUNK_PX * 4, CHUNK_PX);
    expect(range.c0).toBe(3);
    expect(range.c1).toBe(6);
    expect(range.x0).toBe(3 * CHUNK_PX);
    expect(range.x1).toBe(7 * CHUNK_PX);
  });

  it("never asks for a negative chunk at the start of the canvas", () => {
    const range = visibleChunkRange(0, 800);
    expect(range.c0).toBe(0);
    expect(range.x0).toBe(0);
  });

  it("treats a negative scroll offset (rubber-banding) as the origin", () => {
    expect(visibleChunkRange(-200, 800)).toEqual(visibleChunkRange(0, 800));
  });

  it("does not change while both viewport edges stay inside their chunks", () => {
    // Not "within one chunk": the viewport spans several, so the range is
    // stable only while neither edge crosses a boundary.
    const a = visibleChunkRange(CHUNK_PX * 2 + 1, 800);
    const b = visibleChunkRange(CHUNK_PX * 2 + 76, 800);
    expect(sameChunkRange(a, b)).toBe(true);
  });

  it("changes as soon as the trailing edge crosses a boundary", () => {
    const a = visibleChunkRange(CHUNK_PX * 2 + 1, 800);
    const b = visibleChunkRange(CHUNK_PX * 3 - 1, 800);
    expect(sameChunkRange(a, b)).toBe(false);
  });

  it("changes once a chunk boundary is crossed", () => {
    const a = visibleChunkRange(CHUNK_PX * 2, 800);
    const b = visibleChunkRange(CHUNK_PX * 4, 800);
    expect(sameChunkRange(a, b)).toBe(false);
  });
});

describe("inChunkRange", () => {
  const range = visibleChunkRange(CHUNK_PX * 4, CHUNK_PX);

  it("keeps a box inside the window", () => {
    expect(inChunkRange(range, CHUNK_PX * 4, 20)).toBe(true);
  });

  it("keeps a box that merely overlaps an edge", () => {
    expect(inChunkRange(range, range.x0 - 10, 20)).toBe(true);
    expect(inChunkRange(range, range.x1 - 1, 40)).toBe(true);
  });

  it("drops a box entirely outside", () => {
    expect(inChunkRange(range, range.x0 - 100, 10)).toBe(false);
    expect(inChunkRange(range, range.x1 + 10, 10)).toBe(false);
  });

  it("keeps a zero-width box that touches the window", () => {
    expect(inChunkRange(range, range.x0, 0)).toBe(true);
  });
});
