/* oxlint-disable react/react-compiler -- redesign chrome caches selection/flash/timeline refs; not Compiler-safe by design */
import { useEffect, useRef, useState } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import { useTraceVersion } from "../useLens.js";
import { readFresh, derivationCache } from "../traceFresh.js";
import { loadPanelPrefs, savePanelPrefs } from "../panelPrefs.js";
import { typeLaneKey } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import { useTimeline } from "../timeline/useTimeline.js";
import { Timeline } from "../timeline/view/Timeline.js";
import { buildRenderStory } from "../inspector/renderStory.js";
import { Inspector, type EditApi } from "../Inspector.js";
import { InspectorView } from "./InspectorView.js";
import { columnTemplate, fitColumns, nextColumnWidth, type CollapsedPanes } from "./columns.js";
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
  onAddToAgent,
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
  /** Hand a component to the AI panel from a cascade row. */
  onAddToAgent?: (id: ComponentId, name: string) => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const [fixApplied, setFixApplied] = useState(false);
  const [flashId, setFlashId] = useState<ComponentId | null>(null);
  const timeline = useTimeline({ store, causality, cursor, fixApplied });
  const gridRef = useRef<HTMLDivElement>(null);
  const [inspW, setInspW] = useState(() => loadPanelPrefs().inspectorWidth);
  const [gridW, setGridW] = useState(0);
  const [collapsed, setCollapsed] = useState<CollapsedPanes>(() => ({
    inspector: loadPanelPrefs().inspectorCollapsed,
  }));
  useEffect(() => {
    const host = gridRef.current;
    if (!host) return;
    const apply = () => setGridW(host.getBoundingClientRect().width);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const fitted = fitColumns(gridW || Number.POSITIVE_INFINITY, inspW, collapsed);
  useEffect(() => {
    savePanelPrefs({
      inspectorWidth: inspW,
      inspectorCollapsed: collapsed.inspector,
    });
  }, [inspW, collapsed]);
  const togglePane = (which: keyof CollapsedPanes) =>
    setCollapsed((prev) => ({ ...prev, [which]: !prev[which] }));
  const startColumnDrag = () => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const host = gridRef.current;
    if (!host) return;
    const move = (ev: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      setInspW(nextColumnWidth(rect.right - ev.clientX, { total: rect.width, inspW, collapsed }));
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
  const shellCaches = useRef({
    story: derivationCache<ReturnType<typeof buildRenderStory> | null>(),
  }).current;
  const selectedRender = timeline.state.selectedRender;
  const story = shellCaches.story.read([store, causality, selectedRender, version], () =>
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
          <span className="brand-name">React Lens</span>
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
        style={{ gridTemplateColumns: columnTemplate(fitted.inspW, collapsed) }}
      >
        {!collapsed.inspector && (
          <div
            className="colresize"
            style={{ right: fitted.inspW }}
            title="Drag to resize"
            onPointerDown={startColumnDrag()}
          />
        )}{" "}
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
              {...(doctor ? { flagged: doctor } : {})}
              {...(onAddToAgent ? { onAddToAgent } : {})}
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
                  renderId={selectedRender}
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
