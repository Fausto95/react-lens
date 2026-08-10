import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, RenderId } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { Inspector, type EditApi } from "./Inspector.js";
import { Tree } from "./Tree.js";
import { Timeline } from "./Timeline.js";
import { diagnoseAll } from "./doctor.js";
import { createDoctorClient, type DoctorResult } from "./doctorClient.js";
import { CommandPalette, type Command } from "./CommandPalette.js";
import type { TimeCursor, ABMarks } from "./timeCursor.js";
import { IconLens, IconBolt, IconSearch, IconDoctor, IconDownload, IconUpload, IconCrosshair } from "@react-lens/icons";
import {
  downloadSession,
  importSessionFromFile,
  listRecentSessions,
  loadSessionFromIdb,
  importSession,
} from "./session.js";
import { WasteBanner } from "./WasteBanner.js";
import { sourceResolver } from "./sourceResolver.js";
import "./theme.css";

export { configureSourceFetcher, getSourceResolver } from "./sourceResolver.js";
export type { EditApi } from "./Inspector.js";

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
  /** Page Inspect mode active (crosshair pick on the page). */
  inspecting?: boolean;
  onToggleInspect?: () => void;
  /** External selection (e.g. inspect-picked from the page). */
  selectComponent?: ComponentId | null;
  onSelectConsumed?: () => void;
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
  inspecting = false,
  onToggleInspect,
  selectComponent,
  onSelectConsumed,
}: PanelProps) {
  useTraceVersion(store, { kind: "global" });
  const [selected, setSelected] = useState<ComponentId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [treeModeHint, setTreeModeHint] = useState<"waste" | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<
    Array<{ id: string; title: string; eventCount: number }>
  >([]);
  const importRef = useRef<HTMLInputElement>(null);
  // Global time cursor + A/B marks (redesign §6, §28) — the temporal spine
  // shared by the Timeline, Tree, and Inspector.
  const [cursor, setCursor] = useState<TimeCursor>({ t: 0, mode: "live" });
  const [ab, setAB] = useState<ABMarks>({});
  const [explainToken, setExplainToken] = useState(0);
  const { width, onResizeStart } = useDockResize(embedded);
  const { splitPct, bodyRef, onSplitStart } = usePaneSplit();
  const stats = store.stats();

  useEffect(() => {
    if (selectComponent == null) return;
    setSelected(selectComponent);
    onSelectConsumed?.();
  }, [selectComponent, onSelectConsumed]);

  // Time sync: when scrubbed into the past, dim tree components that weren't in
  // the commit at the cursor (reuses the Freeze-Frame styling).
  const frozenSet = cursor.mode === "historical"
    ? new Set(store.commitAt(cursor.t)?.componentIds ?? [])
    : null;

  // Doctor: components with at least one diagnostic (for tree badges + count).
  // The pass walks every component and runs causality per render, so it runs in
  // a Web Worker mirroring the store — off the panel's main thread. If the
  // worker can't be created it falls back to a synchronous pass (guarded on very
  // large apps so the panel stays responsive).
  const doctorClient = useMemo(() => createDoctorClient(), []);
  const [workerDoctor, setWorkerDoctor] = useState<DoctorResult | null>(null);
  useEffect(() => {
    const client = doctorClient;
    if (!client) return;
    const unsubscribe = client.subscribe(setWorkerDoctor);
    client.ingest(store.export()); // backfill history captured before we attached
    const off = store.onIngest((batch) => client.ingest(batch));
    return () => {
      unsubscribe();
      off();
      client.dispose();
    };
  }, [doctorClient, store]);

  // Push selected component source into the Doctor worker for static+runtime fusion.
  useEffect(() => {
    const client = doctorClient;
    if (!client || selected == null) return;
    const inst = store.instance(selected);
    if (!inst?.source) return;
    let alive = true;
    const compiled = inst.source;
    void Promise.all([
      sourceResolver.resolve(compiled),
      sourceResolver.sourceContent(compiled.file),
    ]).then(([original, src]) => {
      if (!alive || !src) return;
      client.analyzeSource({
        componentId: selected,
        name: inst.name,
        sourceText: src.content,
        file: original?.file ?? src.path,
      });
    });
    return () => {
      alive = false;
    };
  }, [doctorClient, store, selected]);

  // The store was cleared (page navigated/reloaded) — return the timeline to
  // LIVE and drop A/B marks so it doesn't sit at a now-gone historical moment.
  const empty = stats.events === 0;
  useEffect(() => {
    if (empty) {
      setCursor({ t: 0, mode: "live" });
      setAB({});
      setSelected(null);
      setSessionLabel(null);
    }
  }, [empty]);

  const fallback = !doctorClient && stats.components <= 2000 ? diagnoseAll(store, causality) : null;
  const affected = workerDoctor?.affected ?? fallback?.affected ?? new Set<ComponentId>();
  const issueCount = workerDoctor?.count ?? fallback?.diagnostics.length ?? 0;
  const suspended = new Set(store.allInstances().filter((i) => i.suspended).map((i) => i.id));

  // ⌘K / Ctrl+K opens the command palette; ⌘\ toggles page inspect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "\\" || e.code === "Backslash") && onToggleInspect) {
        e.preventDefault();
        onToggleInspect();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleInspect]);

  useEffect(() => {
    if (!paletteOpen) return;
    void listRecentSessions().then(setRecentSessions);
  }, [paletteOpen]);

  const goLive = useCallback(() => {
    const commits = store.commits();
    const t = commits.at(-1)?.timestamp ?? 0;
    setCursor({ t, mode: "live" });
  }, [store]);

  const commands: Command[] = [];
  commands.push({
    id: "go-live",
    label: "Go live",
    hint: "L",
    group: "Timeline",
    run: goLive,
  });
  commands.push({
    id: "explain-interaction",
    label: "Explain this interaction",
    hint: "?",
    group: "Timeline",
    run: () => setExplainToken((n) => n + 1),
  });
  if (onToggleInspect) {
    commands.push({
      id: "toggle-inspect",
      label: inspecting ? "Stop inspecting page" : "Inspect element on page",
      hint: "⌘\\",
      group: "Navigate",
      run: onToggleInspect,
    });
  }
  if (onToggleOverlay) {
    commands.push({
      id: "toggle-overlay",
      label: overlayEnabled ? "Disable render overlay" : "Enable render overlay",
      hint: "⚡",
      group: "Navigate",
      run: onToggleOverlay,
    });
  }
  if (onToggleRecording) {
    commands.push({
      id: "toggle-recording",
      label: recording ? "Pause recording" : "Start recording",
      hint: "R",
      group: "Navigate",
      run: onToggleRecording,
    });
  }
  commands.push({
    id: "export-session",
    label: "Export session",
    hint: "↓",
    group: "Session",
    run: () => downloadSession(store),
  });
  commands.push({
    id: "import-session",
    label: "Import session",
    hint: "↑",
    group: "Session",
    run: () => importRef.current?.click(),
  });
  for (const entry of recentSessions) {
    commands.push({
      id: `session:${entry.id}`,
      label: `Open · ${entry.title}`,
      hint: `${entry.eventCount} ev`,
      group: "Session",
      run: () => {
        void loadSessionFromIdb(entry.id).then((file) => {
          if (!file) return;
          importSession(store, file);
          setSelected(null);
          setCursor({ t: 0, mode: "live" });
          setAB({});
          setSessionLabel(file.meta?.title ?? entry.title);
        });
      },
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
        {sessionLabel && (
          <span className="rl-session-label" title={sessionLabel}>
            {sessionLabel}
          </span>
        )}
        <span className="rl-spacer" />
        {onToggleInspect && (
          <button
            className={`rl-icon-btn${inspecting ? " active" : ""}`}
            onClick={onToggleInspect}
            title="Inspect element on page (⌘\\)"
            aria-label="Inspect element on page"
            aria-pressed={inspecting}
          >
            <IconCrosshair size={14} />
          </button>
        )}
        <button
          className="rl-icon-btn"
          onClick={() => setPaletteOpen(true)}
          title="Command palette (⌘K)"
          aria-label="Command palette (⌘K)"
        >
          <IconSearch size={14} />
        </button>
        <button
          className="rl-icon-btn"
          onClick={() => downloadSession(store)}
          title="Export session"
          aria-label="Export session"
        >
          <IconDownload size={14} />
        </button>
        <button
          className="rl-icon-btn"
          onClick={() => importRef.current?.click()}
          title="Import session"
          aria-label="Import session"
        >
          <IconUpload size={14} />
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json,.lens.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void importSessionFromFile(store, file)
              .then((session) => {
                setSelected(null);
                setCursor({ t: 0, mode: "live" });
                setAB({});
                setSessionLabel(session.meta?.title ?? file.name);
              })
              .catch(() => {
                /* invalid file — ignore for MVP */
              });
          }}
        />
        {onToggleOverlay && (
          <button
            className={`rl-icon-btn${overlayEnabled ? " active" : ""}`}
            onClick={onToggleOverlay}
            title="Toggle render overlay"
            aria-label="Toggle render overlay"
            aria-pressed={overlayEnabled}
          >
            <IconBolt size={13} />
          </button>
        )}
        <button
          className={`rl-icon-btn recording severe${recording ? " active" : ""}`}
          onClick={onToggleRecording}
          title={recording ? "Pause recording (R)" : "Start recording (R)"}
          aria-label={recording ? "Pause recording (R)" : "Start recording (R)"}
          aria-pressed={recording}
        >
          <span className="rl-rec-pulse" />
        </button>
      </div>

      <WasteBanner
        store={store}
        causality={causality}
        onInspect={({ worstId }) => {
          setTreeModeHint("waste");
          if (worstId) setSelected(worstId);
        }}
      />

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
            modeHint={treeModeHint}
            onModeHintConsumed={() => setTreeModeHint(null)}
            {...(frozenSet ? { frozen: frozenSet } : {})}
          />
        </div>

        <div className="rl-resizer" onPointerDown={onSplitStart} title="Drag to resize" />

        <div className="rl-pane">
          <div className="rl-pane-title">Inspector</div>
          {selected === null ? (
            <div className="rl-empty rl-empty-action">
              <span>No component selected.</span>
              <span className="rl-empty-hint">Pick one in the tree, waterfall, or ⌘K.</span>
            </div>
          ) : (
            <Inspector
              store={store}
              causality={causality}
              componentId={selected}
              cursor={cursor}
              ab={ab}
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
        causality={causality}
        cursor={cursor}
        ab={ab}
        onCursor={setCursor}
        onSetAB={setAB}
        onSelectComponent={setSelected}
        selectedComponent={selected}
        explainToken={explainToken}
        {...(onHighlight ? { onHighlight } : {})}
        {...(onReplayCommit ? { onReplay: onReplayCommit } : {})}
      />

      <div className="rl-statusbar">
        <span className="rl-status-metric" title="Events">
          <span className="rl-status-k">ev</span> {stats.events}
        </span>
        <span className="rl-status-metric" title="Renders">
          <span className="rl-status-k">rnd</span> {stats.renders}
        </span>
        <span className="rl-status-metric" title="Components">
          <span className="rl-status-k">cmp</span> {stats.components}
        </span>
        {suspended.size > 0 && (
          <span className="rl-status-metric warn" title="Suspended">
            <span className="rl-status-k">sus</span> {suspended.size}
          </span>
        )}
        {issueCount > 0 && (
          <span className="rl-status-metric warn" title="Doctor issues">
            <IconDoctor size={11} /> {issueCount}
          </span>
        )}
        <span className="rl-spacer" />
        <details className="rl-status-about">
          <summary>{embedded ? "embedded" : "devtools"}</summary>
          <div className="rl-status-about-pop">protocol v1</div>
        </details>
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
