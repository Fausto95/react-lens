import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { ComponentId } from "@reactlens/protocol";
import type { SemanticNode, VisibleRow } from "@reactlens/tree";
import { laneVisibility, typeLaneKey, type LaneControls, type LaneKey } from "../laneFilter.js";
import { rowWindow } from "../rowWindow.js";

/**
 * The concept's `.tree` column: indented `.node` rows carrying a diagnostic
 * glyph, hover solo/mute actions, a waste badge, a heat bar and a count.
 */

export interface TreeViewRow {
  row: VisibleRow;
  /** Indent in px — the concept's `--pl`. */
  pl: number;
}

/** Region-scoped heat for a type lane — drives the heat bar / count / waste. */
export interface LaneHeat {
  renders: number;
  wasted: number;
  selfMs: number;
}

const INDENT = 11;
const BASE_PL = 10;
/**
 * Indent stops growing past this depth. A 14-level tree at the concept's
 * 14px/level pushes the name past the column and the heat bar off the row —
 * the guide rail matters more than the exact depth once you're this deep.
 */
const MAX_INDENT_DEPTH = 8;

/*
 * Rows are windowed (see rowWindow.ts): this component used to mount every row
 * of the tree, thousands in a real app, all re-rendered on each trace ingest.
 */

/** Fixed row height (`.node` in redesign.css) — the virtualizer's estimate. */
const ROW_H = 26;

export function treeViewRows(rows: VisibleRow[]): TreeViewRow[] {
  return rows.map((row) => ({
    row,
    pl: BASE_PL + Math.min(row.depth, MAX_INDENT_DEPTH) * INDENT,
  }));
}

function glyphFor(node: SemanticNode, doctor: boolean): { text: string; cls: string } | null {
  if (node.kind === "group") return null;
  if (doctor) return { text: "⚠", cls: "g-warn" };
  if (node.datum.observableChange === false) return { text: "⚠", cls: "g-warn" };
  if (node.datum.kind === "server-boundary") return { text: "◉", cls: "g-ctx" };
  if (node.datum.compiled) return { text: "✓", cls: "g-ok" };
  return null;
}

export function TreeView({
  rows,
  maxSelf,
  selected,
  doctor,
  lanes,
  watchlist = [],
  regionHeat,
  componentHeat,
  fixApplied = false,
  flashId = null,
  onSelect,
  onToggle,
  onHover,
}: {
  rows: TreeViewRow[];
  maxSelf: number;
  /** Pinned problem components — the concept's Watchlist section. */
  watchlist?: Array<{ id: ComponentId; name: string; issues: number; renders: number }>;
  selected: ComponentId | null;
  doctor?: Set<ComponentId>;
  lanes?: LaneControls;
  /** When set, heat/count/waste come from the timeline selection, not the session. */
  regionHeat?: Map<LaneKey, LaneHeat>;
  /** Per-instance heat — what a component row shows. */
  componentHeat?: Map<ComponentId, LaneHeat>;
  /** Theatrical replay: hide waste badges and cool the heat. */
  fixApplied?: boolean;
  /** Clip→tree flash — briefly highlights the matching row. */
  flashId?: ComponentId | null;
  onSelect: (id: ComponentId) => void;
  onToggle: (key: string) => void;
  onHover?: (id: ComponentId | null) => void;
}) {
  /**
   * Keyboard walk: ↑↓ move (selecting as they go, Linear-style), → expands or
   * descends, ← collapses or jumps to the parent, Enter acts on the row.
   */
  // No local filtering: the query is already applied upstream by
  // `buildTree({ include: parsed.predicate })`, which understands regex and
  // structured tokens. A second naive substring pass here matched the literal
  // text "/^tick/" against component names and hid every row.
  const visible = rows;
  // With nothing selected the walk starts at the root row, so the first
  // ArrowDown steps to its child rather than re-selecting the root.
  const selectedIndex = visible.findIndex(
    ({ row }) => row.node.kind === "component" && row.node.id === selected,
  );
  const focusIndex = selectedIndex < 0 ? 0 : selectedIndex;
  const focusRow = (idx: number) => {
    const entry = visible[Math.max(0, Math.min(visible.length - 1, idx))];
    if (entry && entry.row.node.kind === "component") onSelect(entry.row.node.id);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const entry = visible[focusIndex];
    if (e.key === "ArrowDown") focusRow(focusIndex + 1);
    else if (e.key === "ArrowUp") focusRow(focusIndex - 1);
    else if (e.key === "ArrowRight") {
      if (entry?.row.expandable && !entry.row.expanded) onToggle(entry.row.node.key);
      else focusRow(focusIndex + 1);
    } else if (e.key === "ArrowLeft") {
      if (entry?.row.expandable && entry.row.expanded) onToggle(entry.row.node.key);
      else if (entry) {
        // Nearest earlier row one level up.
        for (let i = focusIndex - 1; i >= 0; i--) {
          if (visible[i]!.row.depth < entry.row.depth) {
            focusRow(i);
            break;
          }
        }
      }
    } else if (e.key === "Enter") {
      if (entry?.row.node.kind === "group") onToggle(entry.row.node.key);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * Only the rows near the viewport are mounted.
   *
   * The redesign dropped the windowing v1 had, so every row of the tree was in
   * the DOM at once — a few thousand nodes in a real app, re-rendered on every
   * trace ingest. Rows are a fixed 26px, and `scrollMargin` accounts for the
   * watchlist section sitting above the list inside the same scroller.
   */
  const [scrollMargin, setScrollMargin] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    setScrollMargin(list.offsetTop - scroller.offsetTop);
  }, [watchlist.length]);

  // Scroll position is state, updated from the scroller's own event — render
  // reads state, never a ref, which is what keeps this component compilable.
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setViewport(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const win = rowWindow({
    count: rows.length,
    rowHeight: ROW_H,
    scrollTop,
    viewport,
    scrollMargin,
  });

  useEffect(() => {
    if (flashId === null && selected === null) return;
    const id = flashId ?? selected;
    const index = rows.findIndex(({ row }) => row.node.kind === "component" && row.node.id === id);
    // The row may not be mounted, so compute where it is rather than ask the
    // DOM for an element that may not exist.
    const el = scrollRef.current;
    if (index < 0 || !el) return;
    const rowTop = scrollMargin + index * ROW_H;
    const rowBottom = rowTop + ROW_H;
    if (rowTop < el.scrollTop) el.scrollTop = rowTop;
    else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }
  }, [flashId, selected, rows, scrollMargin]);

  /**
   * A row's own numbers.
   *
   * A tree row is one *instance*, so it reads `componentHeat`. Reading the
   * type lane here was the bug behind the implausible counts: in a Chakra app
   * every one of hundreds of `<Insertion>` rows showed the total for all of
   * them. Group rows keep the aggregate, because a group genuinely is one.
   */
  const heatFor = (
    key: { componentId: ComponentId } | { name: string },
    fallbackRenders: number,
    fallbackSelf: number,
    fallbackWaste: number,
  ): { renders: number; self: number; waste: number } => {
    if (regionHeat) {
      const heat =
        "componentId" in key
          ? componentHeat?.get(key.componentId)
          : regionHeat.get(typeLaneKey(key.name));
      if (!heat) return { renders: 0, self: 0, waste: 0 };
      if (fixApplied) {
        return {
          renders: Math.max(0, heat.renders - heat.wasted),
          self: heat.selfMs * (heat.renders > 0 ? (heat.renders - heat.wasted) / heat.renders : 1),
          waste: 0,
        };
      }
      return { renders: heat.renders, self: heat.selfMs, waste: heat.wasted };
    }
    return {
      renders: fallbackRenders,
      self: fallbackSelf,
      waste: fixApplied ? 0 : fallbackWaste,
    };
  };

  // The bar is comparable only against the same population the rows show:
  // scaling instance rows by the largest *type* total flattened every bar in
  // an app with one hot type.
  const regionMaxSelf = regionHeat
    ? Math.max(
        1,
        ...[...(componentHeat?.values() ?? [])].map((h) => h.selfMs),
        ...[...regionHeat.values()].map((h) => h.selfMs),
        1,
      )
    : maxSelf;
  const heatDenom = regionHeat ? regionMaxSelf : maxSelf;

  return (
    <div
      ref={scrollRef}
      className="tree rl-tree-scroll"
      role="tree"
      aria-label="Component tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      onMouseLeave={() => onHover?.(null)}
    >
      {watchlist.length > 0 && <div className="sect">Watchlist</div>}
      {watchlist.map((entry) => {
        const h = heatFor({ componentId: entry.id }, entry.renders, entry.renders, entry.issues);
        return (
          <div
            key={`w:${entry.id}`}
            className={`node${entry.id === selected ? " sel" : ""}${
              flashId === entry.id ? " flash" : ""
            }`}
            data-component={entry.id}
            style={{ "--pl": "14px" } as CSSProperties}
            onClick={() => onSelect(entry.id)}
            onMouseEnter={() => onHover?.(entry.id)}
          >
            <span className="chev" />
            <span className="glyph g-warn">⚠</span>
            <span className="nm">{entry.name}</span>
            <div className="heat">
              {h.waste > 0 && <span className="waste">{h.waste}</span>}
              <div className="hbar">
                <i
                  style={{ "--w": `${Math.round((h.self / heatDenom) * 100)}%` } as CSSProperties}
                />
              </div>
              <span className="cnt">{h.renders}</span>
            </div>
          </div>
        );
      })}
      {watchlist.length > 0 && <div className="sect">App</div>}
      <div ref={listRef} style={{ height: win.totalHeight, position: "relative" }}>
        {rows.slice(win.start, win.end).map(({ row, pl }, i) => {
          const rowTop = (win.start + i) * ROW_H;
          const { node, expandable, expanded } = row;
          const isComponent = node.kind === "component";
          const name = isComponent ? node.datum.name : node.name;
          const laneKey = typeLaneKey(name);
          const state = lanes ? laneVisibility(lanes.filter, laneKey) : "visible";
          const hasDoctor = isComponent && !!doctor?.has(node.id);
          const glyph = glyphFor(node, hasDoctor);
          const fallbackRenders = isComponent ? node.datum.renders : node.renders;
          const fallbackSelf = isComponent ? node.datum.selfTime : node.selfTime;
          const fallbackWaste = node.kind === "group" ? node.suspicious : 0;
          const h = heatFor(
            isComponent ? { componentId: node.id } : { name },
            fallbackRenders,
            fallbackSelf,
            fallbackWaste,
          );
          const soloed = lanes?.filter.solo.has(laneKey) ?? false;
          const muted = lanes?.filter.muted.has(laneKey) ?? false;
          const flashing = isComponent && flashId === node.id;

          return (
            <div
              key={row.key}
              // `rl-tree-row` / `rl-tree-name` and the treeitem role are the
              // panel's stable contract (e2e, and anything scripting the panel).
              // The concept's class names sit alongside them, not instead.
              className={`node rl-tree-row${isComponent && node.id === selected ? " sel rl-selected" : ""}${
                state === "muted" ? " is-muted" : ""
              }${flashing ? " flash" : ""}`}
              role="treeitem"
              aria-selected={isComponent && node.id === selected}
              aria-expanded={expandable ? expanded : undefined}
              data-component={isComponent ? node.id : undefined}
              style={
                {
                  "--pl": `${pl}px`,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${rowTop}px)`,
                } as CSSProperties
              }
              onClick={() => {
                if (isComponent) onSelect(node.id);
                else onToggle(node.key);
              }}
              onMouseEnter={() => isComponent && onHover?.(node.id)}
            >
              <span
                className="chev"
                onClick={(e) => {
                  if (!expandable) return;
                  e.stopPropagation();
                  onToggle(node.key);
                }}
              >
                {expandable ? (expanded ? "▾" : "▸") : ""}
              </span>
              {glyph && <span className={`glyph ${glyph.cls}`}>{glyph.text}</span>}
              <span className="nm rl-tree-name">{name}</span>
              {node.kind === "group" && <span className="x nm">×{node.count}</span>}

              {lanes && (
                <div className={`rowact${soloed || muted ? " pinned" : ""}`}>
                  <span
                    className={`ra${soloed ? " on" : ""}`}
                    data-act="solo"
                    title={`Solo ${name} — trace only this`}
                    role="button"
                    aria-pressed={soloed}
                    onClick={(e) => {
                      e.stopPropagation();
                      lanes.toggleSolo(laneKey);
                    }}
                  >
                    S
                  </span>
                  <span
                    className={`ra${muted ? " on" : ""}`}
                    data-act="mute"
                    title={
                      muted
                        ? `Unmute ${name} — its history was never dropped`
                        : `Mute ${name} — hide it from every view (still recorded)`
                    }
                    role="button"
                    aria-pressed={muted}
                    onClick={(e) => {
                      e.stopPropagation();
                      lanes.toggleMute(laneKey);
                    }}
                  >
                    M
                  </span>
                </div>
              )}

              <div className="heat">
                {h.waste > 0 && <span className="waste">{h.waste}</span>}
                <div className="hbar">
                  <i
                    style={
                      {
                        "--w": `${heatDenom > 0 ? Math.round((h.self / heatDenom) * 100) : 0}%`,
                      } as CSSProperties
                    }
                  />
                </div>
                <span className="cnt">{h.renders}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
