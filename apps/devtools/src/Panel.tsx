import { useState, useCallback, useEffect, useRef } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { Inspector, type EditApi } from "./Inspector.js";
import { Tree } from "./Tree.js";
import { CommandPalette, type Command } from "./CommandPalette.js";
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
}: PanelProps) {
  useTraceVersion(store, { kind: "global" });
  const [selected, setSelected] = useState<ComponentId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { width, onResizeStart } = useDockResize(embedded);
  const stats = store.stats();

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
          <span className="rl-dot">◈</span> React Lens
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
            ⚡ Renders
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

      <div className="rl-body">
        <div className="rl-pane rl-pane-tree">
          <div className="rl-pane-title">Tree</div>
          <Tree
            store={store}
            causality={causality}
            selected={selected}
            onSelect={setSelected}
            onHover={onHighlight}
          />
        </div>

        <div className="rl-pane">
          <div className="rl-pane-title">Inspector</div>
          {selected === null ? (
            <div className="rl-empty">Select a component to inspect its renders and causes.</div>
          ) : (
            <Inspector
              store={store}
              causality={causality}
              componentId={selected}
              {...(edit ? { edit } : {})}
              {...(onHighlight ? { highlight: onHighlight } : {})}
            />
          )}
        </div>
      </div>

      <div className="rl-statusbar">
        <span>{stats.events} events</span>
        <span>{stats.renders} renders</span>
        <span>{stats.components} components</span>
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
