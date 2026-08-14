/* oxlint-disable react-hooks/exhaustive-deps -- args.version intentionally invalidates memoized reads from the mutable TraceStore */
/* oxlint-disable react/react-compiler -- scroll window state */
import { useMemo, useState } from "react";
import type { TraceStore, VisibleTreeRow } from "@reactlens/trace-engine";
import { TreeFlags } from "@reactlens/trace-engine";

/**
 * Viewport query over the flat tree index. React only mounts the returned rows.
 */
export function useTreeWindow(
  store: TraceStore,
  args: {
    version: number;
    expanded: ReadonlySet<string>;
    scrollTop: number;
    viewH: number;
    rowHeight?: number;
    projection?: "all" | "changed" | "waste";
  },
): { rows: VisibleTreeRow[]; totalRows: number; totalHeight: number } {
  const rowHeight = args.rowHeight ?? 26;
  return useMemo(() => {
    const include =
      args.projection === "changed"
        ? (index: number) => (store.flatTree.flags[index]! & TreeFlags.ChangedLast) !== 0
        : args.projection === "waste"
          ? (index: number) => (store.flatTree.flags[index]! & TreeFlags.WastedLast) !== 0
          : undefined;
    return store.flatTree.queryWindow({
      expanded: args.expanded,
      scrollTop: args.scrollTop,
      viewH: args.viewH,
      rowHeight,
      include,
    });
  }, [store, args.version, args.expanded, args.scrollTop, args.viewH, rowHeight, args.projection]);
}

/** Local scroll state helper for tree panes. */
export function useTreeScrollState(initial = 0) {
  const [scrollTop, setScrollTop] = useState(initial);
  return { scrollTop, setScrollTop };
}
