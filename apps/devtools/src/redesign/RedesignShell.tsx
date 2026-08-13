import { useEffect, useRef, useState } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import {
  buildTree,
  flatten,
  parseQuery,
  type ComponentDatum,
  type SemanticNode,
} from "@reactlens/tree";
import { useTraceVersion } from "../useLens.js";
import { readFresh, useDerived } from "../useDerived.js";
import { loadPanelPrefs, savePanelPrefs } from "../panelPrefs.js";
import { typeLaneKey, type LaneControls } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import { useTimeline } from "../timeline/useTimeline.js";
import { Timeline } from "../timeline/view/Timeline.js";
import { buildRenderStory } from "../inspector/renderStory.js";
import { Inspector, type EditApi } from "../Inspector.js";
import { TreeView, treeViewRows } from "./TreeView.js";
import { InspectorView } from "./InspectorView.js";
import { columnTemplate, nextColumnWidth, type CollapsedPanes } from "./columns.js";
import { ErrorBoundary } from "../ErrorBoundary.js";

/**
 * Panel layout: toolbar over three columns — Components · Timeline · Inspector.
 *
 * The shell owns only what spans columns (the filter, column widths, the
 * "replay with fix" mode). The timeline owns its own state through
 * `useTimeline`; the shell reads that model for the inspector and the tree's
 * region heat rather than keeping a second copy of it.
 */
export function RedesignShell({
  store,
  causality,
  recording,
  cursor,
  onCursor,
  lanes,
  doctor,
  selected,
  onSelect,
  onHighlight,
  sessionSpanMs,
  toolbarActions,
  transport,
  windowChrome = false,
  edit,
  onRequestSnapshot,
  onAskAI,
}: {
  store: TraceStore;
  causality: Causality;
  recording: boolean;
  cursor: TimeCursor;
  onCursor: (c: TimeCursor) => void;
  lanes: LaneControls;
  doctor?: Set<ComponentId>;
  selected: ComponentId | null;
  onSelect: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  sessionSpanMs: number;
  /** Panel actions (⌘K, agent, sessions…) rendered into the toolbar. */
  toolbarActions?: React.ReactNode;
  /** Panel-owned timeline controls (travel toggle, A/B…) for the footer. */
  transport?: React.ReactNode;
  /**
   * The concept's faux traffic lights. Off in the real panel — it isn't a
   * window — but available to the playground and site, which present the panel
   * as a screenshot-style card.
   */
  windowChrome?: boolean;
  edit?: EditApi;
  onRequestSnapshot?: (renderId: RenderId) => void;
  onAskAI?: (question: string) => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const [fixApplied, setFixApplied] = useState(false);
  const [flashId, setFlashId] = useState<ComponentId | null>(null);

  const timeline = useTimeline({
    store,
    causality,
    cursor,
    laneFilter: lanes.filter,
    fixApplied,
  });

  // ── Filter: structured tokens become chips, free text stays in the input ──
  const [filterChips, setFilterChips] = useState<string[]>([]);
  const [filterFree, setFilterFree] = useState("");
  const query = [...filterChips, filterFree.trim()].filter(Boolean).join(" ");
  const filterRef = useRef<HTMLInputElement>(null);

  const commitFilterTokens = (raw: string) => {
    const bits = raw.trim().split(/\s+/).filter(Boolean);
    const structured = bits.filter((t) => t.includes(":"));
    if (structured.length === 0) return false;
    setFilterChips((prev) => [...prev, ...structured.filter((t) => !prev.includes(t))]);
    setFilterFree(bits.filter((t) => !t.includes(":")).join(" "));
    return true;
  };
  const onFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && filterFree === "" && filterChips.length > 0) {
      e.preventDefault();
      setFilterChips((prev) => prev.slice(0, -1));
      return;
    }
    if ((e.key === " " || e.key === "Enter") && commitFilterTokens(filterFree)) e.preventDefault();
  };

  // ── Column widths ────────────────────────────────────────────────────────
  const gridRef = useRef<HTMLDivElement>(null);
  const [treeW, setTreeW] = useState(() => loadPanelPrefs().treeWidth);
  const [inspW, setInspW] = useState(() => loadPanelPrefs().inspectorWidth);
  /**
   * Collapsed panes keep their stored width, so expanding restores the layout
   * the user had rather than a default.
   */
  const [collapsed, setCollapsed] = useState<CollapsedPanes>(() => {
    const prefs = loadPanelPrefs();
    return { tree: prefs.treeCollapsed, inspector: prefs.inspectorCollapsed };
  });
  useEffect(() => {
    savePanelPrefs({
      treeWidth: treeW,
      inspectorWidth: inspW,
      treeCollapsed: collapsed.tree,
      inspectorCollapsed: collapsed.inspector,
    });
  }, [treeW, inspW, collapsed]);
  const togglePane = (which: keyof CollapsedPanes) =>
    setCollapsed((prev) => ({ ...prev, [which]: !prev[which] }));

  const startColumnDrag =
    (which: "tree" | "inspector") => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const host = gridRef.current;
      if (!host) return;
      // Window-level, so a drag that outruns the 7px strip keeps tracking.
      const move = (ev: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        const wanted = which === "tree" ? ev.clientX - rect.left : rect.right - ev.clientX;
        const next = nextColumnWidth(which, wanted, {
          total: rect.width,
          treeW,
          inspW,
          collapsed,
        });
        (which === "tree" ? setTreeW : setInspW)(next);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  // ── Tree ─────────────────────────────────────────────────────────────────
  const [collapsedNodes, setCollapsedNodes] = useState<ReadonlySet<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const data = useDerived([store, causality, version], () => buildData(store, causality));
  const parsed = parseQuery(query);
  const roots = buildTree(data, { include: parsed.predicate });
  const expanded = (() => {
    const set = new Set<string>();
    const walk = (nodes: SemanticNode[]) => {
      for (const node of nodes) {
        if (node.kind === "group") {
          if (openGroups.has(node.key)) set.add(node.key);
          walk(node.instances);
        } else {
          if (!collapsedNodes.has(node.key)) set.add(node.key);
          walk(node.children);
        }
      }
    };
    walk(roots);
    return set;
  })();
  const treeRows = treeViewRows(flatten(roots, expanded));
  const matchCount = query.trim() ? data.filter(parsed.predicate).length : null;
  const maxSelf = Math.max(
    1,
    ...treeRows.map(({ row }) =>
      row.node.kind === "component" ? row.node.datum.selfTime : row.node.selfTime,
    ),
  );
  const toggleTree = (key: string) => {
    const setter = key.startsWith("g:") ? setOpenGroups : setCollapsedNodes;
    setter((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  /** Watchlist: Doctor-flagged components, heaviest first. */
  const watchlist = useDerived([doctor, store, version], () => {
    if (!doctor || doctor.size === 0) return [];
    return [...doctor]
      .map((id) => ({
        id,
        name: store.instance(id)?.name ?? `#${id}`,
        issues: 1,
        renders: store.renderCount(id),
      }))
      .sort((a, b) => b.renders - a.renders)
      .slice(0, 3);
  });

  // ── Inspector ────────────────────────────────────────────────────────────
  const selectedRender = timeline.state.selectedRender;
  const story = useDerived([store, causality, selectedRender, version], () =>
    selectedRender === null ? null : buildRenderStory(store, causality, selectedRender),
  );
  const selectedRenderEvent = readFresh(version, () =>
    selectedRender !== null ? store.getRender(selectedRender) : undefined,
  );
  /** Clip picks set this so a following `selected` change doesn't clear the clip. */
  const fromClipRef = useRef(false);

  useEffect(() => {
    if (flashId === null) return;
    const id = window.setTimeout(() => setFlashId(null), 700);
    return () => window.clearTimeout(id);
  }, [flashId]);

  // Tree / ⌘K / page-inspect change `selected` without a clip. Drop any prior
  // clip so the inspector switches to component details.
  useEffect(() => {
    if (fromClipRef.current) {
      fromClipRef.current = false;
      return;
    }
    if (timeline.state.selectedRender !== null) {
      timeline.dispatch({ type: "clearClip" });
    }
  }, [selected]);

  /** Picking in the tree highlights the matching lane and scrolls it into view. */
  const selectTreeComponent = (id: ComponentId) => {
    // Always leave clip mode — even when re-clicking the same component — so
    // the inspector shows props/state/… instead of the render story.
    timeline.dispatch({ type: "clearClip" });
    onSelect(id);
    const name = store.instance(id)?.name;
    if (!name) return;
    const key = typeLaneKey(name);
    timeline.dispatch({ type: "selectLane", laneKey: key });
    document.querySelector(`[data-lane="${key}"]`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <>
      <div className="toolbar">
        {windowChrome && (
          <div className="dots">
            <i />
            <i />
            <i />
          </div>
        )}
        <div className="brand">
          <span className="lens" />
          React Lens
        </div>
        <div className="rec" title="Recording is always on">
          {recording && <i />}
          {recording ? `Recording · ${(sessionSpanMs / 1000).toFixed(1)} s` : "Paused"}
        </div>
        <span className="hint">
          drag to scrub · ⇧ region · ⌥ marquee · J/K/L transport · ? shortcuts
        </span>
        <div className="legend">
          {(["props", "state", "ctx", "cascade"] as const).map((key) => (
            <span key={key}>
              <i className="sw" style={{ background: `var(--${key})` }} />
              {key === "ctx" ? "context" : key}
            </span>
          ))}
        </div>
        {toolbarActions}
        <span className="kbd">⌘K</span>
      </div>

      <div
        className="grid"
        ref={gridRef}
        style={{ gridTemplateColumns: columnTemplate(treeW, inspW, collapsed) }}
      >
        {/* A collapsed pane is a rail — there is nothing left to resize. */}
        {!collapsed.tree && (
          <div
            className="colresize"
            style={{ left: treeW }}
            title="Drag to resize"
            onPointerDown={startColumnDrag("tree")}
          />
        )}
        {!collapsed.inspector && (
          <div
            className="colresize"
            style={{ right: inspW }}
            title="Drag to resize"
            onPointerDown={startColumnDrag("inspector")}
          />
        )}

        {collapsed.tree ? (
          <PaneRail label="Components" side="left" onExpand={() => togglePane("tree")} />
        ) : (
          <div className="col">
            <div className="colhead">
              Components
              <PaneToggle label="Components" side="left" onClick={() => togglePane("tree")} />
            </div>
            <div className="filter">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#5C5C66"
                strokeWidth="2.4"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              {filterChips.map((token) => (
                <span
                  key={token}
                  className="chip"
                  title="Click to remove"
                  role="button"
                  tabIndex={0}
                  onClick={() => setFilterChips((prev) => prev.filter((t) => t !== token))}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setFilterChips((prev) => prev.filter((t) => t !== token))
                  }
                >
                  {token}
                </span>
              ))}
              <input
                ref={filterRef}
                className="rl-tree-search"
                placeholder={filterChips.length > 0 ? "Filter…" : "Filter components…"}
                value={filterFree}
                spellCheck={false}
                aria-invalid={parsed.errors.length > 0}
                {...(parsed.errors.length > 0 ? { title: parsed.errors.join(" · ") } : {})}
                onChange={(e) => setFilterFree(e.target.value)}
                onKeyDown={onFilterKeyDown}
                onBlur={() => commitFilterTokens(filterFree)}
              />
              {parsed.errors.length > 0 ? (
                <span className="rl-tree-search-count invalid">!</span>
              ) : (
                matchCount !== null && <span className="rl-tree-search-count">{matchCount}</span>
              )}
            </div>
            <ErrorBoundary scope="components">
              <TreeView
                rows={treeRows}
                maxSelf={maxSelf}
                selected={selected}
                onSelect={selectTreeComponent}
                onToggle={toggleTree}
                watchlist={watchlist}
                lanes={lanes}
                regionHeat={timeline.statsRaw.byLane}
                componentHeat={timeline.statsRaw.byComponent}
                fixApplied={fixApplied}
                flashId={flashId}
                {...(doctor ? { doctor } : {})}
                {...(onHighlight ? { onHover: onHighlight } : {})}
              />
            </ErrorBoundary>
          </div>
        )}

        <div className="col">
          <div className="colhead">
            Timeline
            <span className="right">
              {timeline.state.region
                ? `selection ${Math.round(
                    timeline.state.region.start - timeline.bounds.t0,
                  ).toLocaleString("en-US")} – ${Math.round(
                    timeline.state.region.end - timeline.bounds.t0,
                  ).toLocaleString("en-US")} ms`
                : `${timeline.stats.renders} renders in view`}
            </span>
          </div>
          <ErrorBoundary scope="timeline">
            <Timeline
              model={timeline}
              cursor={cursor}
              onCursor={onCursor}
              lanes={lanes}
              fixApplied={fixApplied}
              onSelectComponent={(id) => {
                fromClipRef.current = true;
                onSelect(id);
                setFlashId(id);
              }}
              {...(onHighlight ? { onHighlight } : {})}
              {...(transport ? { transport } : {})}
            />
          </ErrorBoundary>
        </div>

        {collapsed.inspector ? (
          <PaneRail label="Inspector" side="right" onExpand={() => togglePane("inspector")} />
        ) : (
          <div className="col insp">
            <ErrorBoundary scope="inspector">
              {selectedRender !== null ? (
                <InspectorView
                  headAction={
                    <PaneToggle
                      label="Inspector"
                      side="right"
                      onClick={() => togglePane("inspector")}
                    />
                  }
                  store={store}
                  componentId={selectedRenderEvent?.componentId ?? selected}
                  story={story}
                  t0={
                    selectedRenderEvent ? selectedRenderEvent.timestamp - timeline.bounds.t0 : null
                  }
                  t1={
                    selectedRenderEvent
                      ? selectedRenderEvent.timestamp -
                        timeline.bounds.t0 +
                        selectedRenderEvent.selfDuration
                      : null
                  }
                  fixApplied={fixApplied}
                  onToggleFix={() => setFixApplied((v) => !v)}
                  onSelectComponent={selectTreeComponent}
                  onHoverComponent={(id) => {
                    onHighlight?.(id);
                    if (id === null) return;
                    const name = store.instance(id)?.name;
                    if (name) timeline.dispatch({ type: "selectLane", laneKey: typeLaneKey(name) });
                  }}
                />
              ) : selected !== null ? (
                <Inspector
                  store={store}
                  causality={causality}
                  componentId={selected}
                  cursor={cursor}
                  onSelectComponent={selectTreeComponent}
                  headAction={
                    <PaneToggle
                      label="Inspector"
                      side="right"
                      onClick={() => togglePane("inspector")}
                    />
                  }
                  {...(edit ? { edit } : {})}
                  {...(onHighlight ? { highlight: onHighlight } : {})}
                  {...(onRequestSnapshot ? { onRequestSnapshot } : {})}
                  {...(onAskAI ? { onAskAI } : {})}
                />
              ) : (
                <InspectorView
                  headAction={
                    <PaneToggle
                      label="Inspector"
                      side="right"
                      onClick={() => togglePane("inspector")}
                    />
                  }
                  store={store}
                  componentId={null}
                  story={null}
                  t0={null}
                  t1={null}
                  fixApplied={fixApplied}
                  onToggleFix={() => setFixApplied((v) => !v)}
                />
              )}
            </ErrorBoundary>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The chevron that collapses a side pane, sitting at the end of its heading.
 * It points the way the pane will go, so the control reads as its own effect.
 */
function PaneToggle({
  label,
  side,
  onClick,
}: {
  label: string;
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="panetoggle"
      title={`Collapse ${label}`}
      aria-label={`Collapse ${label}`}
      aria-expanded={true}
      onClick={onClick}
    >
      {side === "left" ? "\u2039" : "\u203A"}
    </button>
  );
}

/**
 * What a collapsed pane leaves behind: a rail carrying its name and the way
 * back. Vertical text rather than an icon, so the pane is still identifiable
 * at 28px wide.
 */
function PaneRail({
  label,
  side,
  onExpand,
}: {
  label: string;
  side: "left" | "right";
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      className="panerail"
      title={`Expand ${label}`}
      aria-label={`Expand ${label}`}
      aria-expanded={false}
      onClick={onExpand}
    >
      <span className="chev">{side === "left" ? "\u203A" : "\u2039"}</span>
      <span className="rl-rail-label">{label}</span>
    </button>
  );
}

function buildData(store: TraceStore, causality: Causality): ComponentDatum[] {
  return store
    .allInstances()
    .filter((i) => store.renderCount(i.id) > 0)
    .map((i) => {
      let observableChange: boolean | null = null;
      const last = store.rendersOf(i.id).at(-1);
      if (last) {
        try {
          const verdict = causality.why(last.renderId).verdict;
          observableChange =
            verdict === "no-observable-change" ? false : verdict === "expected" ? true : null;
        } catch {
          observableChange = null;
        }
      }
      return {
        id: i.id,
        name: i.name,
        renders: store.renderCount(i.id),
        selfTime: store.selfTimeTotal(i.id),
        compiled: i.compiler.compiled,
        observableChange,
        ...(i.parentId !== undefined ? { parentId: i.parentId } : {}),
        ...(i.kind && i.kind !== "component" ? { kind: i.kind } : {}),
      } satisfies ComponentDatum;
    });
}
