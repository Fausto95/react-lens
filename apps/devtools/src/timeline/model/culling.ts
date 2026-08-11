/**
 * Horizontal culling for the lane canvas.
 *
 * The canvas spans the whole session, so at a deep zoom it is far wider than
 * the viewport and most clips are off-screen. Rather than recompute a visible
 * set on every scroll pixel, the axis is divided into fixed chunks and only the
 * chunk range changes — so scroll-driven React state updates land roughly twice
 * a second while panning instead of every frame.
 */

export interface ChunkRange {
  /** First and last chunk index covered (inclusive), with overscan. */
  c0: number;
  c1: number;
  /** Pixel window the chunk range covers. */
  x0: number;
  x1: number;
}

export const CHUNK_PX = 512;

export function visibleChunkRange(
  scrollLeft: number,
  viewportW: number,
  chunk = CHUNK_PX,
  overscan = 1,
): ChunkRange {
  const c0 = Math.max(0, Math.floor(Math.max(0, scrollLeft) / chunk) - overscan);
  const c1 = Math.floor((Math.max(0, scrollLeft) + Math.max(0, viewportW)) / chunk) + overscan;
  return { c0, c1, x0: c0 * chunk, x1: (c1 + 1) * chunk };
}

/** True when a box overlaps the culling window at all. */
export function inChunkRange(range: ChunkRange, left: number, width: number): boolean {
  return left + width >= range.x0 && left <= range.x1;
}

/** Chunk ranges are compared by index, so scrolling within a chunk is a no-op. */
export function sameChunkRange(a: ChunkRange, b: ChunkRange): boolean {
  return a.c0 === b.c0 && a.c1 === b.c1;
}
