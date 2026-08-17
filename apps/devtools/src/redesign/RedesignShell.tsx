/* oxlint-disable react/react-compiler -- redesign chrome caches selection/flash/timeline refs; not Compiler-safe by design */
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
import { readFresh, derivationCache } from "../traceFresh.js";
import { loadPanelPrefs, savePanelPrefs } from "../panelPrefs.js";
import { typeLaneKey } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import { useTimeline } from "../timeline/useTimeline.js";
import { Timeline } from "../timeline/view/Timeline.js";
import { buildRenderStory } from "../inspector/renderStory.js";
import { Inspector, type EditApi } from "../Inspector.js";
import { TreeView, treeViewRows } from "./TreeView.js";
import { InspectorView } from "./InspectorView.js";
import { columnTemplate, nextColumnWidth, type CollapsedPanes } from "./columns.js";
import { ErrorBoundary } from "../ErrorBoundary.js";

export function RedesignShell({
  store,
  causality,
  cursor,
  onCursor,
  doctor,
  selected,
  onSelect,
  onHighlight,
  toolbarActions,
  transport,
  windowChrome = false,
  edit,
  onRequestSnapshot,
  onAskAI,
}: {
  store: TraceStore;
  causality: Causality;
  cursor: TimeCursor;
  onCursor: (c: TimeCursor) => void;
  doctor?: Set<ComponentId>;
  selected: ComponentId | null;
  onSelect: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  toolbarActions?: React.ReactNode;
  transport?: React.ReactNode;
  windowChrome?: boolean;
  edit?: EditApi;
  onRequestSnapshot?: (renderId: RenderId) => void;
  onAskAI?: (question: string) => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const [fixApplied, setFixApplied] = useState(false);
  const [flashId, setFlashId] = useState<ComponentId | null>(null);
  const timeline = useTimeline({ store, causality, cursor, fixApplied });
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
  const gridRef = useRef<HTMLDivElement>(null);
  const [treeW, setTreeW] = useState(() => loadPanelPrefs().treeWidth);
  const [inspW, setInspW] = useState(() => loadPanelPrefs().inspectorWidth);
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
      const move = (ev: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        const wanted = which === "tree" ? ev.clientX - rect.left : rect.right - ev.clientX;
        const next = nextColumnWidth(which, wanted, { total: rect.width, treeW, inspW, collapsed });
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
  const [collapsedNodes, setCollapsedNodes] = useState<ReadonlySet<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const treeCaches = useRef({
    data: derivationCache<ReturnType<typeof buildData>>(),
    watchlist:
      derivationCache<Array<{ id: ComponentId; name: string; issues: number; renders: number }>>(),
    story: derivationCache<ReturnType<typeof buildRenderStory> | null>(),
  }).current;
  const data = treeCaches.data.read([store, causality, version], () => buildData(store, causality));
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
  const watchlist = treeCaches.watchlist.read([doctor, store, version], () => {
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
  const selectedRender = timeline.state.selectedRender;
  const story = treeCaches.story.read([store, causality, selectedRender, version], () =>
    selectedRender === null ? null : buildRenderStory(store, causality, selectedRender),
  );
  const selectedRenderEvent = readFresh(version, () =>
    selectedRender !== null ? store.getRender(selectedRender) : undefined,
  );
  const fromClipRef = useRef(false);
  useEffect(() => {
    if (flashId === null) return;
    const id = window.setTimeout(() => setFlashId(null), 700);
    return () => window.clearTimeout(id);
  }, [flashId]);
  // Only when the tree selection changes. A clip-driven select sets fromClipRef
  // so we don't immediately clear the clip we just chose.
  useEffect(() => {
    if (fromClipRef.current) {
      fromClipRef.current = false;
      return;
    }
    if (timeline.state.selectedRender !== null) timeline.dispatch({ type: "clearClip" });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- selectedRender must not be a dep or selecting a clip would clear itself
  }, [selected]);
  const selectTreeComponent = (id: ComponentId) => {
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
        {!collapsed.tree && (
          <div
            className="colresize"
            style={{ left: treeW }}
            title="Drag to resize"
            onPointerDown={startColumnDrag("tree")}
          />
        )}{" "}
        {!collapsed.inspector && (
          <div
            className="colresize"
            style={{ right: inspW }}
            title="Drag to resize"
            onPointerDown={startColumnDrag("inspector")}
          />
        )}{" "}
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
            Cascade
            <span className="right">
              {timeline.state.region
                ? `selection ${Math.round(timeline.state.region.start - timeline.bounds.t0).toLocaleString("en-US")} – ${Math.round(timeline.state.region.end - timeline.bounds.t0).toLocaleString("en-US")} ms`
                : `${timeline.stats.renders} renders in view`}
            </span>
          </div>
          <ErrorBoundary scope="cascade">
            <Timeline
              model={timeline}
              cursor={cursor}
              onCursor={onCursor}
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
                  onSelectRender={(renderId, laneKey) => {
                    const render = store.getRender(renderId);
                    if (render) {
                      fromClipRef.current = true;
                      onSelect(render.componentId);
                    }
                    timeline.dispatch({ type: "selectClip", renderId, laneKey });
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

function PaneIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg
      className="paneicon"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.25"
        y="2.75"
        width="13.5"
        height="12.5"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d={side === "left" ? "M6.25 3v12" : "M11.75 3v12"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
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
      <PaneIcon side={side} />
    </button>
  );
}
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
      <PaneIcon side={side} />
      <span className="rl-rail-label">{label}</span>
    </button>
  );
}
function buildData(store: TraceStore, _causality: Causality): ComponentDatum[] {
  return store
    .allInstances()
    .filter((i) => store.renderCount(i.id) > 0)
    .map((i) => {
      const observableChange = store.flatTree.lastObservable(i.id as number);
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
