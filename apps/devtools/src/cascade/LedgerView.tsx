import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentId } from "@reactlens/protocol";
import { IconCollapse, IconSparkle } from "@reactlens/icons";
import { FilterField } from "../FilterField.js";
import type { CascadeDelta } from "./deltaModel.js";
import {
  cascadeBaseName,
  isUnnamedRender,
  type CascadeNode,
  type CascadeProjection,
} from "./model.js";
import {
  ancestorIds,
  buildLedgerRows,
  chainIds,
  collapsibleIds,
  ledgerRowIndex,
  ownerNodeOf,
  type LedgerRow,
} from "./ledgerModel.js";

/**
 * Cascade as an indented list. Depth is indentation, so the whole cascade reads
 * top-to-bottom in one column and windows to any size: rows are a fixed height,
 * so only the visible slice is ever in the DOM.
 */

/** Must match `--cascade-ledger-row` in cascade.css. */
const ROW_H = 24;
const OVERSCAN = 8;
/** Must match the guide stripe period in cascade.css. */
const INDENT = 13;
/**
 * Past some number of levels the indent stops growing and the true depth moves
 * into a chip. Real trees reach depth 30+; letting indentation win means the
 * names — the only thing you are reading — get squeezed off the right edge.
 * The cap is a share of the pane, because "too deep" is relative to how much
 * room the dock actually gives us.
 */
const INDENT_BUDGET = 0.3;
const MAX_INDENT_CAP = 12;
const MIN_INDENT_CAP = 4;

function indentCap(paneWidth: number): number {
  const affordable = Math.floor((paneWidth * INDENT_BUDGET) / INDENT);
  return Math.max(MIN_INDENT_CAP, Math.min(MAX_INDENT_CAP, affordable));
}

export interface LedgerViewProps {
  projection: CascadeProjection | null;
  selectedId: string | null;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (node: CascadeNode) => void;
  onHover: (node: CascadeNode | null) => void;
  /** Components the Doctor flagged — the old Components-pane watchlist. */
  flagged?: ReadonlySet<ComponentId>;
  /** Hand a component to the AI panel. Omitted when the agent is unavailable. */
  onAddToAgent?: (id: ComponentId, name: string) => void;
  /** When set, show only what changed since the compared interaction. */
  delta?: CascadeDelta | null;
}

function causeClass(cause: CascadeNode["cause"]): string {
  switch (cause) {
    case "state":
    case "props":
    case "context":
      return cause;
    case "mount":
      return "mount";
    default:
      return "cascade";
  }
}

/** Up to `cap` keys plus a count of the rest — one glance, full list in the tooltip. */
const PROPS_CAP = 3;

function PropKeys({
  keys,
  fresh,
}: {
  keys: readonly string[];
  /** Keys that did not cross for this component in the compared interaction. */
  fresh: ReadonlySet<string>;
}): React.ReactNode {
  // New keys first, so a delta never hides the thing it is pointing at behind "+n".
  const ordered = [...keys].sort((a, b) => Number(fresh.has(b)) - Number(fresh.has(a)));
  const shown = ordered.slice(0, PROPS_CAP);
  const rest = ordered.length - shown.length;
  return (
    <span
      className="rl-ledger-props"
      title={`Props that crossed this render: ${keys.join(", ")}${
        fresh.size > 0 ? `\nNew since the compared interaction: ${[...fresh].join(", ")}` : ""
      }`}
    >
      {shown.map((key, i) => (
        <span key={key} className={fresh.has(key) ? "is-new" : undefined}>
          {i > 0 ? "·" : ""}
          {key}
        </span>
      ))}
      {rest > 0 ? ` +${rest}` : ""}
    </span>
  );
}

function Bar({
  row,
  scale,
  self,
}: {
  row: LedgerRow;
  scale: number;
  self: number;
}): React.ReactNode {
  const width = (value: number) =>
    `${Math.min(100, Math.max(value > 0 ? 2 : 0, (value / scale) * 100))}%`;
  return (
    <span
      className="rl-ledger-bar"
      title={`self ${self.toFixed(2)}ms · subtree ${row.subtree.selfTime.toFixed(2)}ms`}
    >
      <i
        className={`rl-ledger-bar-subtree cause-${causeClass(row.node.cause)}`}
        style={{ width: width(row.subtree.selfTime) }}
      />
      <i
        className={`rl-ledger-bar-self cause-${causeClass(row.node.cause)}`}
        style={{ width: width(self) }}
      />
    </span>
  );
}

export function LedgerView({
  projection,
  selectedId,
  query,
  onQuery,
  onSelect,
  onHover,
  flagged,
  onAddToAgent,
  delta = null,
}: LedgerViewProps): React.ReactNode {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expandedChains, setExpandedChains] = useState<ReadonlySet<string>>(new Set());
  /** Row being pointed at by a hovered ⤿ Owner marker — the edge, drawn on demand. */
  const [ownerTargetId, setOwnerTargetId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const [viewportWidth, setViewportWidth] = useState(720);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box) return;
      if (box.height > 0) setViewportHeight(box.height);
      if (box.width > 0) setViewportWidth(box.width);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Collapse state is per-interaction: the caller remounts this view with a new
  // `key` when the interaction changes, rather than resetting it in an effect.
  const rows = projection
    ? buildLedgerRows(projection, {
        collapsed,
        query,
        expandedChains,
        ...(delta ? { only: delta.changed } : {}),
      })
    : [];
  const scale = Math.max(
    0.001,
    ...rows.map((row) => row.subtree.selfTime),
    projection?.totalSelfTime ?? 0.001,
  );
  const selectedIndex = ledgerRowIndex(rows, selectedId);

  const scrollTo = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || index < 0) return;
    const top = index * ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = top + ROW_H - scroller.clientHeight;
  }, []);

  // A selection made in another lens (or in the component tree) has to be
  // brought into view here. Only chase it when it actually moved, so hovering
  // and scrolling never yank the viewport.
  const chasedRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId === chasedRef.current) return;
    chasedRef.current = selectedId;
    if (selectedIndex >= 0) scrollTo(selectedIndex);
  }, [scrollTo, selectedId, selectedIndex]);

  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Unlock every link at once, or the next one would just re-fold. */
  const expandChain = useCallback((row: LedgerRow) => {
    setExpandedChains((previous) => new Set([...previous, ...chainIds(row)]));
  }, []);

  /**
   * Follow a ⤿ Owner marker to the owner's own row. The owner may sit inside a
   * collapsed subtree, so its ancestors are opened first; the selection chase
   * then scrolls to it once the rows include it.
   */
  const jumpToOwner = useCallback(
    (node: CascadeNode) => {
      if (!projection) return;
      const owner = ownerNodeOf(projection, node);
      if (!owner) return;
      const reveal = ancestorIds(projection, owner.id);
      setCollapsed((previous) => {
        if (!reveal.some((id) => previous.has(id))) return previous;
        const next = new Set(previous);
        for (const id of reveal) next.delete(id);
        return next;
      });
      chasedRef.current = null;
      onSelect(owner);
    },
    [onSelect, projection],
  );

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visible = Math.ceil(viewportHeight / ROW_H) + OVERSCAN * 2;
  const slice = rows.slice(first, first + visible);
  const collapsedAny = collapsed.size > 0;
  const maxIndent = indentCap(viewportWidth);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const move = (delta: number) => {
      const target = rows[Math.min(rows.length - 1, Math.max(0, selectedIndex + delta))];
      if (!target) return;
      event.preventDefault();
      onSelect(target.node);
      scrollTo(rows.indexOf(target));
    };
    const current = rows[selectedIndex];
    switch (event.key) {
      case "ArrowDown":
        return move(selectedIndex < 0 ? 0 : 1);
      case "ArrowUp":
        return move(selectedIndex < 0 ? 0 : -1);
      case "Home":
        return move(-rows.length);
      case "End":
        return move(rows.length);
      case "ArrowRight":
        if (current?.hasChildren && current.collapsed) {
          event.preventDefault();
          toggle(current.node.id);
        }
        return;
      case "ArrowLeft":
        if (current?.hasChildren && !current.collapsed) {
          event.preventDefault();
          toggle(current.node.id);
        } else if (current?.node.parentId) {
          const parent = rows.find((row) => row.node.id === current.node.parentId);
          if (parent) {
            event.preventDefault();
            onSelect(parent.node);
            scrollTo(rows.indexOf(parent));
          }
        }
        return;
      default:
        return;
    }
  };

  return (
    <div className="rl-ledger">
      <div className="rl-ledger-toolbar">
        <FilterField
          value={query}
          onChange={onQuery}
          onKeyDown={(event) => {
            if (event.key === "Escape") onQuery("");
          }}
        />
        <button
          type="button"
          className="rl-cascade-tool"
          aria-label={collapsedAny ? "Expand every subtree" : "Collapse every subtree"}
          aria-pressed={collapsedAny}
          title={collapsedAny ? "Expand every subtree" : "Collapse every subtree"}
          onClick={() =>
            setCollapsed(collapsedAny || !projection ? new Set() : collapsibleIds(projection))
          }
        >
          <IconCollapse size={13} />
        </button>
        <span className="rl-ledger-count">
          {rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"}
        </span>
      </div>

      <div
        className="rl-ledger-scroller"
        ref={scrollerRef}
        tabIndex={0}
        role="tree"
        aria-label="Render cascade"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        onMouseLeave={() => onHover(null)}
      >
        {rows.length === 0 ? (
          <div className="rl-cascade-empty">
            {delta && !query
              ? `Nothing changed since the previous “${delta.against.label}”.`
              : query
                ? `No component matches “${query}”.`
                : "No render cascade is available for this interaction."}
          </div>
        ) : (
          <div className="rl-ledger-spacer" style={{ height: rows.length * ROW_H }}>
            {slice.map((row, i) => {
              const index = first + i;
              const node = row.node;
              const chain = row.chain;
              const tail = chain ? chain[chain.length - 1]! : node;
              // Naming the tail only helps when the tail has a name — a chain of
              // library wrappers ends on another `Anonymous`, which says nothing.
              const showTail = chain !== null && !isUnnamedRender(tail) && tail.name !== node.name;
              const self = chain
                ? chain.reduce((total, link) => total + link.selfDuration, 0)
                : node.selfDuration;
              const hidden = row.subtree.renderCount - node.aggregateCount;
              const clamped = Math.min(row.depth, maxIndent);
              // A folded chain is one cause, so its prop keys union cleanly.
              const propsKeys = chain
                ? [...new Set(chain.flatMap((link) => [...link.changedProps]))]
                : [...node.changedProps];
              const owner = node.ownerEdge === true ? node.ownerName : null;
              const ownerNode = owner && projection ? ownerNodeOf(projection, node) : null;
              const links = chain ?? [node];
              const freshKeys = new Set(
                delta ? links.flatMap((link) => delta.newKeysByNode.get(link.id) ?? []) : [],
              );
              const deltaMark = !delta
                ? null
                : links.some((link) => delta.newRenders.has(link.id))
                  ? "new"
                  : freshKeys.size > 0
                    ? "keys"
                    : null;
              return (
                <div
                  key={node.id}
                  className="rl-ledger-row"
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-selected={node.id === selectedId}
                  aria-expanded={row.hasChildren ? !row.collapsed : undefined}
                  data-selected={node.id === selectedId || undefined}
                  data-muted={!row.matched || undefined}
                  data-owner-target={node.id === ownerTargetId || undefined}
                  data-delta={deltaMark ?? undefined}
                  style={{ transform: `translateY(${index * ROW_H}px)` }}
                  onMouseEnter={() => onHover(node)}
                  onClick={() => onSelect(node)}
                  onDoubleClick={() => row.hasChildren && toggle(node.id)}
                >
                  <span className="rl-ledger-name">
                    {/* One element, not one per level: at depth 30 that is 30
                        DOM nodes per row for a background you can paint. */}
                    <span
                      className="rl-ledger-indent"
                      style={{ width: clamped * INDENT }}
                      aria-hidden="true"
                    />
                    {row.depth > maxIndent ? (
                      <span className="rl-ledger-depth" title={`Causal depth ${row.depth}`}>
                        d{row.depth}
                      </span>
                    ) : null}
                    <span
                      className="rl-ledger-twist"
                      data-open={row.hasChildren && !row.collapsed ? "true" : undefined}
                      onClick={(event) => {
                        if (!row.hasChildren) return;
                        event.stopPropagation();
                        toggle(node.id);
                      }}
                    >
                      {row.hasChildren ? "▶" : ""}
                    </span>
                    <span className={`rl-ledger-dot cause-${causeClass(node.cause)}`} />
                    <span className="rl-ledger-label">{node.name}</span>
                    {deltaMark === "new" ? (
                      <span
                        className="rl-ledger-delta"
                        title={`Did not render in the previous “${delta!.against.label}”`}
                      >
                        new
                      </span>
                    ) : null}
                    {propsKeys.length > 0 ? <PropKeys keys={propsKeys} fresh={freshKeys} /> : null}
                    {owner ? (
                      <button
                        type="button"
                        className="rl-ledger-owner"
                        disabled={ownerNode === null}
                        title={`Props came from ${owner} — the component that renders ${cascadeBaseName(
                          node,
                        )} — not from the parent above it.${
                          ownerNode ? " Click to jump to its render." : " It did not render here."
                        }`}
                        aria-label={`Owner ${owner}${ownerNode ? ", jump to its render" : ""}`}
                        onMouseEnter={() => setOwnerTargetId(ownerNode?.id ?? null)}
                        onMouseLeave={() => setOwnerTargetId(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          jumpToOwner(node);
                        }}
                      >
                        ⤿ {owner}
                      </button>
                    ) : null}
                    {node.componentId !== null && flagged?.has(node.componentId) ? (
                      <span
                        className="rl-ledger-glyph g-warn"
                        title="The Doctor found an issue with this component"
                        aria-label="has a Doctor issue"
                      >
                        ⚠
                      </span>
                    ) : null}
                    {node.compiled === true ? (
                      <span
                        className="rl-ledger-glyph g-ok"
                        title="Compiled by the React Compiler"
                        aria-label="compiled"
                      >
                        ✓
                      </span>
                    ) : null}
                    {onAddToAgent && node.componentId !== null ? (
                      <button
                        type="button"
                        className="rl-fix-ai rl-row-ai"
                        title={`Add ${node.name} to the AI panel`}
                        aria-label={`Add ${node.name} to the AI panel`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddToAgent(node.componentId!, node.name);
                        }}
                      >
                        <IconSparkle size={11} />
                      </button>
                    ) : null}
                    {chain ? (
                      <>
                        <button
                          type="button"
                          className="rl-ledger-links"
                          title={`${chain.length} pass-through renders — click to expand\n${chain
                            .map((link) => link.name)
                            .join(" › ")}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            expandChain(row);
                          }}
                        >
                          ⋯{chain.length}
                        </button>
                        {showTail ? (
                          <span className="rl-ledger-label rl-ledger-tail">{tail.name}</span>
                        ) : null}
                      </>
                    ) : null}
                  </span>
                  <span className="rl-ledger-meta">
                    {row.collapsed && hidden > 0 ? `+${hidden.toLocaleString()}` : ""}
                  </span>
                  <Bar row={row} scale={scale} self={self} />
                  <span
                    className="rl-ledger-ms"
                    data-hot={
                      projection && self / projection.totalSelfTime > 0.15 ? "true" : undefined
                    }
                  >
                    {self.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
