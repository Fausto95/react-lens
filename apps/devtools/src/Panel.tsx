import { useState, useCallback, useEffect, useRef } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, CommitId, RenderId } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { Inspector, type EditApi } from "./Inspector.js";
import { Tree } from "./Tree.js";
import { Timeline } from "./Timeline.js";
import { diagnoseAll } from "./doctor.js";
import { CommandPalette, type Command } from "./CommandPalette.js";
import { IconLens, IconBolt } from "@react-lens/icons";
import "./theme.css";

export interface PanelProps {
  store: TraceStore;
  causality: Causality;
  recording: boolean;
  onToggleRecording?: () => void;
  embedded?: boolean;
  /** Highlight a component's DOM on the page (bidirectional selection). */
  onHighlight?: (id: ComponentId | null) => void;
  /** Live value editing; omit to make the inspector read-only. */
  edit?: EditApi;
  /** Render-overlay toggle (embedded only). */
  overlayEnabled?: boolean;
  onToggleOverlay?: () => void;
  /** Update Wave: flash a commit's components on the page (embedded only). */
  onReplayCommit?: (ids: ComponentId[]) => void;
  /**
   * Fetch one render's heavy snapshot on demand. Present when snapshots aren't
   * streamed inline (the extension, for scale); the inspector calls it for the
   * selected render and the result is ingested into the store.
   */
  onRequestSnapshot?: (renderId: RenderId) => void;
}

export function Panel({
  store,
  causality,
  recording,
  onToggleRecording,
  embedded,
  onHighlight,
  edit,
  overlayEnabled,
  onToggleOverlay,
  onReplayCommit,
  onRequestSnapshot,
}: PanelProps) {
  useTraceVersion(store, { kind: "global" });
  const [selected, setSelected] = useState<ComponentId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [frozenCommit, setFrozenCommit] = useState<CommitId | null>(null);
  const { width, onResizeStart } = useDockResize(embedded);
  const { splitPct, bodyRef, onSplitStart } = usePaneSplit();
  const stats = store.stats();

  // Freeze Frame: the component set that rendered in the frozen commit.
  const frozenSet = frozenCommit !== null
    ? new Set(store.commit(frozenCommit)?.componentIds ?? [])
    : null;

  // Doctor: components with at least one diagnostic (for tree badges). The pass
  // walks every component and runs causality per render, so it's skipped on very
  // large apps to keep the panel responsive (Task 28 moves it to a worker).
  const tooLargeForDoctor = stats.components > 800;
  const { diagnostics, affected } = tooLargeForDoctor
    ? { diagnostics: [], affected: new Set<ComponentId>() }
    : diagnoseAll(store, causality);
  const suspended = new Set(store.allInstances().filter((i) => i.suspended).map((i) => i.id));

  // ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands: Command[] = [];
  if (onToggleOverlay) {
    commands.push({
      id: "toggle-overlay",
      label: overlayEnabled ? "Disable render overlay" : "Enable render overlay",
      hint: "⚡",
      run: onToggleOverlay,
    });
  }
  if (onToggleRecording) {
    commands.push({
      id: "toggle-recording",
      label: recording ? "Pause recording" : "Start recording",
      hint: "R",
      run: onToggleRecording,
    });
  }

  return (
    <div
      className={`rl-root${embedded ? " rl-embedded" : ""}`}
      style={embedded && width ? { width } : undefined}
    >
      {embedded && <div className="rl-resize-handle" onPointerDown={onResizeStart} />}
      <div className="rl-topbar">
        <span className="rl-brand">
          <IconLens className="rl-brand-icon" /> React Lens
        </span>
        <span className="rl-spacer" />
        <button className="rl-btn rl-cmdk-btn" onClick={() => setPaletteOpen(true)} title="Command palette">
          ⌘K
        </button>
        {onToggleOverlay && (
          <button
            className={`rl-btn rl-overlay-toggle${overlayEnabled ? " active" : ""}`}
            onClick={onToggleOverlay}
            title="Toggle render overlay"
            aria-pressed={overlayEnabled}
          >
            <IconBolt size={12} /> Renders
          </button>
        )}
        <button
          className={`rl-rec${recording ? " active" : ""}`}
          onClick={onToggleRecording}
          title={recording ? "Pause recording (R)" : "Start recording (R)"}
          aria-pressed={recording}
        >
          <span className="rl-rec-dot" />
          {recording ? "Recording" : "Paused"}
        </button>
      </div>

      <div className="rl-body" ref={bodyRef} style={{ gridTemplateColumns: `${splitPct}% 6px 1fr` }}>
        <div className="rl-pane rl-pane-tree">
          <div className="rl-pane-title">Tree</div>
          <Tree
            store={store}
            causality={causality}
            selected={selected}
            onSelect={setSelected}
            onHover={onHighlight}
            doctor={affected}
            suspended={suspended}
            {...(frozenSet ? { frozen: frozenSet } : {})}
          />
        </div>

        <div className="rl-resizer" onPointerDown={onSplitStart} title="Drag to resize" />

        <div className="rl-pane">
          <div className="rl-pane-title">Inspector</div>
          {selected === null ? (
            <div className="rl-empty">Select a component to inspect its renders and causes.</div>
          ) : (
            <Inspector
              store={store}
              causality={causality}
              componentId={selected}
              onSelectComponent={setSelected}
              {...(edit ? { edit } : {})}
              {...(onHighlight ? { highlight: onHighlight } : {})}
              {...(onRequestSnapshot ? { onRequestSnapshot } : {})}
            />
          )}
        </div>
      </div>

      <Timeline
        store={store}
        onFreeze={setFrozenCommit}
        {...(onReplayCommit ? { onReplay: onReplayCommit } : {})}
      />

      <div className="rl-statusbar">
        <span>{stats.events} events</span>
        <span>{stats.renders} renders</span>
        <span>{stats.components} components</span>
        {diagnostics.length > 0 && (
          <span className="rl-status-issues">⚕ {diagnostics.length} issues</span>
        )}
        <span style={{ marginLeft: "auto" }}>
          {embedded ? "embedded" : "devtools"} · protocol v1
        </span>
      </div>

      {paletteOpen && (
        <CommandPalette
          store={store}
          commands={commands}
          onSelectComponent={setSelected}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

/** Draggable split between the tree and inspector panes. */
function usePaneSplit(): {
  splitPct: number;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  onSplitStart: (e: React.PointerEvent) => void;
} {
  const [splitPct, setSplitPct] = useState(50);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current || !bodyRef.current) return;
      const r = bodyRef.current.getBoundingClientRect();
      const pct = ((e.clientX - r.left) / r.width) * 100;
      setSplitPct(Math.max(22, Math.min(78, pct)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const onSplitStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.userSelect = "none";
  }, []);

  return { splitPct, bodyRef, onSplitStart };
}

const MIN_WIDTH = 320;
const MAX_WIDTH_MARGIN = 160; // leave at least this much of the page visible

/**
 * Drag-to-resize for the right-docked embedded panel. The handle sits on the
 * left edge; dragging left widens the panel (width = viewport − pointer X).
 * No-op when not embedded (the extension panel fills its own DevTools pane).
 */
function useDockResize(embedded?: boolean): {
  width: number | null;
  onResizeStart: (e: React.PointerEvent) => void;
} {
  const [width, setWidth] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!embedded) return;
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const max = window.innerWidth - MAX_WIDTH_MARGIN;
      setWidth(Math.max(MIN_WIDTH, Math.min(max, window.innerWidth - e.clientX)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [embedded]);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    // Prevent text selection on the page while dragging.
    document.body.style.userSelect = "none";
  }, []);

  return { width, onResizeStart };
}
