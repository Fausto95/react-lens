import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import { useTraceVersion } from "./useLens.js";
import { timeAxis } from "@reactlens/ui";
import { Inspector, type EditApi } from "./Inspector.js";
import { Tree } from "./Tree.js";
import { Timeline } from "./Timeline.js";
import { diagnoseAll } from "./doctor.js";
import { createDoctorClient, type DoctorResult } from "./doctorClient.js";
import { CommandPalette, type Command } from "./CommandPalette.js";
import type { TimeCursor, ABMarks } from "./timeCursor.js";
import {
  createPanelTimeTravel,
  type RestoreStatus,
  type TimeTravelApi,
} from "./timeTravelController.js";
import { loadPanelPrefs, savePanelPrefs } from "./panelPrefs.js";
import { loadAgentSettings } from "./settings.js";
import type { AgentSettings } from "@reactlens/agent";
import { AgentPane } from "./AgentPane.js";
import { SettingsPopover } from "./SettingsPopover.js";
import {
  IconLens,
  IconSearch,
  IconSparkle,
  IconDoctor,
  IconDownload,
  IconUpload,
  IconCrosshair,
  IconSliders,
} from "@reactlens/icons";
import { PanelMenu } from "./PanelMenu.js";
import { applyThemePref, type ThemePref } from "./theme.js";
import {
  downloadSession,
  importSessionFromFile,
  listRecentSessions,
  loadSessionFromIdb,
  importSession,
} from "./session.js";
import { WasteBanner } from "./WasteBanner.js";
import { sourceResolver } from "./sourceResolver.js";
import { createTooltipLayer } from "./tooltip.js";
import "./theme.css";

export { configureSourceFetcher, getSourceResolver } from "./sourceResolver.js";
export type { EditApi } from "./Inspector.js";
export type { TimeTravelApi } from "./timeTravelController.js";

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
  /** Real time travel: restore page state while scrubbing (dev builds only). */
  timeTravel?: TimeTravelApi;
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
  timeTravel,
  onRequestSnapshot,
  inspecting = false,
  onToggleInspect,
  selectComponent,
  onSelectConsumed,
}: PanelProps) {
  useTraceVersion(store, { kind: "global" });
  const [selected, setSelected] = useState<ComponentId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [treeModeHint, setTreeModeHint] = useState<"components" | "waste" | null>(null);
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
  // BYOK AI assistant (drawer) + its provider settings popover.
  const [agentOpen, setAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  // Panel color scheme: dark by default, light/system via the header menu.
  const [themePref, setThemePrefState] = useState<ThemePref>(() => loadPanelPrefs().theme);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => applyThemePref(themePref), [themePref]);
  const setThemePref = useCallback((pref: ThemePref) => {
    setThemePrefState(pref);
    savePanelPrefs({ theme: pref });
  }, []);
  // Loaded once (and on save) so AgentPane doesn't re-read storage per ask.
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadAgentSettings().then((s) => {
      if (alive) setAgentSettings(s);
    });
    return () => {
      alive = false;
    };
  }, [settingsVersion]);
  const [agentAsk, setAgentAsk] = useState<{ token: number; question: string } | null>(null);
  const askAI = useCallback((question: string) => {
    setAgentOpen(true);
    setAgentAsk((prev) => ({ token: (prev?.token ?? 0) + 1, question }));
  }, []);
  const { width, onResizeStart } = useDockResize(embedded);
  const { splitPct, bodyRef, onSplitStart } = usePaneSplit();
  const stats = store.stats();
  /** Session length so far — first to last captured commit. */
  const sessionSpanMs = (() => {
    const commits = store.commits();
    return commits.length > 0 ? commits.at(-1)!.endTimestamp - commits[0]!.timestamp : 0;
  })();

  // Fast themed tooltips for every `title` in the panel (see tooltip.ts).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const tooltips = createTooltipLayer(el);
    return () => tooltips.dispose();
  }, []);

  useEffect(() => {
    if (selectComponent == null) return;
    setSelected(selectComponent);
    onSelectConsumed?.();
  }, [selectComponent, onSelectConsumed]);

  // Real time travel: while the cursor is historical (and the toggle is on),
  // the page's state follows the playhead. On by default when supported;
  // the toggle persists across sessions.
  const [travelOn, setTravelOnState] = useState(() => loadPanelPrefs().travelOn);
  const setTravelOn = (update: (v: boolean) => boolean) =>
    setTravelOnState((v) => {
      const next = update(v);
      savePanelPrefs({ travelOn: next });
      return next;
    });
  const [travelSupported, setTravelSupported] = useState(false);
  // Set-wide restore feedback while traveling (partial-restore pill + markers).
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus | null>(null);
  useEffect(() => {
    if (!timeTravel) return;
    let alive = true;
    void Promise.resolve(timeTravel.supported()).then((ok) => {
      if (alive) setTravelSupported(ok);
    });
    return () => {
      alive = false;
    };
  }, [timeTravel]);
  const travelCtl = useMemo(
    () => (timeTravel ? createPanelTimeTravel(store, timeTravel, setRestoreStatus) : null),
    [store, timeTravel],
  );
  useEffect(() => () => travelCtl?.dispose(), [travelCtl]);
  // Imported sessions never drive the live page: their renderIds belong to a
  // different app run, so real restoration is disabled and the timeline shows
  // captured page DOM instead.
  const offlineSession = sessionLabel != null;
  // Importing pauses recording (see the import handlers). If the user resumes,
  // the first live frame means the store has moved past the imported session —
  // drop the session view and return to live semantics so travel re-enables.
  useEffect(() => {
    if (sessionLabel == null) return;
    return store.onIngest((batch) => {
      if (batch.events.length > 0) setSessionLabel(null);
    });
  }, [store, sessionLabel]);
  /** Common post-import state: fresh cursor, no marks, recording paused. */
  const enterSessionView = useCallback(
    (label: string) => {
      setSelected(null);
      setCursor({ t: 0, mode: "live" });
      setAB({});
      setSessionLabel(label);
      if (recording) onToggleRecording?.();
    },
    [recording, onToggleRecording],
  );
  useEffect(() => {
    travelCtl?.onCursor(cursor, travelOn && travelSupported && !offlineSession);
  }, [travelCtl, cursor, travelOn, travelSupported, offlineSession]);

  // Time sync: when scrubbed into the past, dim tree components that weren't in
  // the commit at the cursor (reuses the Freeze-Frame styling).
  const frozenSet =
    cursor.mode === "historical" ? new Set(store.commitAt(cursor.t)?.componentIds ?? []) : null;

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
  const suspended = new Set(
    store
      .allInstances()
      .filter((i) => i.suspended)
      .map((i) => i.id),
  );

  // ⌘K / Ctrl+K opens the command palette; ⌘\ toggles page inspect.
  // Plain keys (R, ?) match the hints the palette advertises.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "\\" || e.code === "Backslash") &&
        onToggleInspect
      ) {
        e.preventDefault();
        onToggleInspect();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setAgentOpen((v) => !v);
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if ((e.key === "r" || e.key === "R") && onToggleRecording) onToggleRecording();
      else if (e.key === "?") setExplainToken((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleInspect, onToggleRecording]);

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
    id: "toggle-agent",
    label: agentOpen ? "Close AI assistant" : "Ask AI assistant",
    hint: "⌘I",
    group: "Navigate",
    run: () => setAgentOpen((v) => !v),
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
  for (const pref of ["system", "light", "dark"] as const) {
    if (pref === themePref) continue;
    commands.push({
      id: `theme-${pref}`,
      label: `Theme: ${pref[0]!.toUpperCase()}${pref.slice(1)}`,
      group: "Navigate",
      run: () => setThemePref(pref),
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
          enterSessionView(file.meta?.title ?? entry.title);
        });
      },
    });
  }

  return (
    <div
      ref={rootRef}
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
          className={`rl-icon-btn${agentOpen ? " active" : ""}`}
          onClick={() => setAgentOpen((v) => !v)}
          title="AI assistant (⌘I)"
          aria-label="AI assistant (⌘I)"
          aria-pressed={agentOpen}
        >
          <IconSparkle size={14} />
        </button>
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
                enterSessionView(session.meta?.title ?? file.name);
              })
              .catch(() => {
                /* invalid file — ignore for MVP */
              });
          }}
        />
        <span className="rl-menu-anchor">
          <button
            className={`rl-icon-btn${menuOpen ? " active" : ""}`}
            onClick={() => setMenuOpen((v) => !v)}
            title="Panel settings"
            aria-label="Panel settings"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
          >
            <IconSliders size={14} />
          </button>
          <PanelMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            theme={themePref}
            onThemeChange={setThemePref}
            overlay={
              onToggleOverlay
                ? { enabled: overlayEnabled ?? false, toggle: onToggleOverlay }
                : undefined
            }
            reading={embedded ? "embedded" : "devtools"}
          />
        </span>
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

      <div
        className="rl-body"
        ref={bodyRef}
        style={{ gridTemplateColumns: `${splitPct}% 6px 1fr` }}
      >
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
            onAskAI={askAI}
            {...(frozenSet ? { frozen: frozenSet } : {})}
            {...(restoreStatus && restoreStatus.failedIds.size > 0
              ? { unrestorable: new Set(restoreStatus.failedIds.keys()) }
              : {})}
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
              onAskAI={askAI}
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
        onAskAI={askAI}
        offline={offlineSession}
        {...(onHighlight ? { onHighlight } : {})}
        {...(onReplayCommit ? { onReplay: onReplayCommit } : {})}
        {...(timeTravel
          ? {
              travel: {
                on: travelOn && travelSupported && !offlineSession,
                supported: travelSupported && !offlineSession,
                toggle: () => setTravelOn((v) => !v),
                status: restoreStatus,
              },
            }
          : {})}
      />

      <div className="rl-statusbar">
        <span
          className="rl-status-metric"
          title="Events captured this session (renders, commits, interactions, effects)"
        >
          <span className="rl-status-k">ev</span> {stats.events}
        </span>
        <button
          type="button"
          className="rl-status-metric rl-status-action"
          title="Renders recorded — click to jump to the heaviest commit"
          onClick={() => {
            const worst = store
              .commits()
              .reduce<ReturnType<typeof store.commits>[number] | null>(
                (acc, c) => (acc === null || c.totalSelfTime > acc.totalSelfTime ? c : acc),
                null,
              );
            if (worst) setCursor({ t: worst.timestamp, mode: "historical" });
          }}
        >
          <span className="rl-status-k">rnd</span> {stats.renders}
        </button>
        <button
          type="button"
          className="rl-status-metric rl-status-action"
          title="Components seen — click to browse the tree"
          onClick={() => setTreeModeHint("components")}
        >
          <span className="rl-status-k">cmp</span> {stats.components}
        </button>
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
        <span
          className={`rl-status-metric rl-status-rec${recording ? " on" : ""}`}
          title={recording ? "Recording (R to pause)" : "Recording paused (R to resume)"}
        >
          <span className="rl-status-rec-dot" />
          {recording ? `rec · ${timeAxis(Math.max(0, sessionSpanMs))}` : "paused"}
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

      <AgentPane
        open={agentOpen}
        store={store}
        causality={causality}
        settings={agentSettings}
        settingsVersion={settingsVersion}
        askRequest={agentAsk}
        onClose={() => setAgentOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelectComponent={setSelected}
        onCursor={setCursor}
      />
      {settingsOpen && (
        <div className="rl-settings-anchor">
          <SettingsPopover
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onSaved={() => setSettingsVersion((v) => v + 1)}
          />
        </div>
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
  const [splitPct, setSplitPct] = useState(() => loadPanelPrefs().splitPct);
  const splitRef = useRef(splitPct);
  splitRef.current = splitPct;
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
      savePanelPrefs({ splitPct: splitRef.current });
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
  const [width, setWidth] = useState<number | null>(() => loadPanelPrefs().dockWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
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
      if (widthRef.current != null) savePanelPrefs({ dockWidth: widthRef.current });
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
