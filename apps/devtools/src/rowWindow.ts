/**
 * Which rows of a fixed-height list need to exist right now.
 *
 * The tree used to mount every row — a few thousand in a real app, all
 * re-rendered on each trace ingest. This is the arithmetic that stops it.
 *
 * It is deliberately not TanStack Virtual. That library's React binding is on
 * the React Compiler's incompatible list (it returns functions the Compiler
 * will not memoize across, so it declines the whole component), and driving
 * its framework-agnostic core instead requires calling private `_willUpdate`
 * lifecycle hooks from render on every pass — which is precisely what the
 * Compiler forbids. Rows here are a uniform 26px, so the general machinery
 * buys nothing: this is eight lines, has no private API to break against, and
 * leaves the component compilable.
 */

/** Rows kept mounted beyond the viewport, so scrolling reveals no blanks. */
export const OVERSCAN = 10;

export interface RowWindow {
  /** First mounted row index, inclusive. */
  start: number;
  /** Last mounted row index, exclusive. */
  end: number;
  /** Where the mounted block sits inside the full list, in px. */
  offsetTop: number;
  /** Full list height, so the scrollbar reflects every row. */
  totalHeight: number;
}

export function rowWindow({
  count,
  rowHeight,
  scrollTop,
  viewport,
  scrollMargin = 0,
}: {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewport: number;
  /** Content above the list inside the same scroller (the watchlist). */
  scrollMargin?: number;
}): RowWindow {
  const totalHeight = count * rowHeight;
  if (count === 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 };

  // The list's own scroll position lags the scroller's by whatever sits above.
  const top = Math.max(0, scrollTop - scrollMargin);
  const first = Math.floor(top / rowHeight);
  const visible = Math.ceil(viewport / rowHeight);

  const start = Math.max(0, Math.min(count, first - OVERSCAN));
  const end = Math.max(start, Math.min(count, first + visible + OVERSCAN));
  return { start, end, offsetTop: start * rowHeight, totalHeight };
}
