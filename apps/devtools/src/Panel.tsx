import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import { useTraceVersion } from "./useLens.js";
import { readFresh } from "./traceFresh.js";
import { diagnoseAll } from "./doctor.js";
import { createDoctorClient, type DoctorResult } from "./doctorClient.js";
import { CommandPalette, type Command } from "./CommandPalette.js";
import type { TimeCursor } from "./timeCursor.js";
import {
  createPanelTimeTravel,
  type RestoreStatus,
  type TimeTravelApi,
} from "./timeTravelController.js";
import { loadPanelPrefs, savePanelPrefs } from "./panelPrefs.js";
import { useLatest } from "./useLatest.js";
import {
  EMPTY_LANE_FILTER,
  deserializeLaneFilter,
  laneFilterActive,
  serializeLaneFilter,
  toggleMute,
  toggleSolo,
  type LaneControls,
  type LaneFilter,
  type LaneKey,
} from "./laneFilter.js";
import { loadAgentSettings } from "./settings.js";
import type { AgentSettings } from "@reactlens/agent";
import { sessionSpanMs } from "./sessionSpan.js";
import { AgentPane } from "./AgentPane.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { SettingsPopover } from "./SettingsPopover.js";
import {
  IconSearch,
  IconSparkle,
  IconDoctor,
  IconDownload,
  IconUpload,
  IconCrosshair,
  IconSliders,
  IconRewind,
} from "@reactlens/icons";
import { PanelMenu, type Retention } from "./PanelMenu.js";
import { DoctorIssuesMenu } from "./DoctorIssuesMenu.js";
import { applyThemePref, type ThemePref } from "./theme.js";
import {
  downloadSession,
  importSessionFromFile,
  listRecentSessions,
  loadSessionFromIdb,
  importSession,
  parseSessionFile,
  saveSessionToIdb,
  type LensSessionFile,
} from "./session.js";
import type { TraceClient } from "./traceClient.js";
import { sourceResolver } from "./sourceResolver.js";
import { createTooltipLayer } from "./tooltip.js";
import type { EditApi } from "./Inspector.js";
import { RedesignShell } from "./redesign/RedesignShell.js";
import { ErrorChip } from "./ErrorChip.js";
import { reportNotice } from "./errors.js";
import "./theme.css";
import "./redesign.css";

export { configureSourceFetcher, getSourceResolver } from "./sourceResolver.js";
export { configureComponentLocator } from "./sourceLocator.js";
export { configureSourceRevealer } from "./revealSource.js";
export type { ComponentLocator, LocatedSource } from "./sourceLocator.js";
export type { EditApi } from "./Inspector.js";
export type { TimeTravelApi } from "./timeTravelController.js";

export interface PanelProps {
  store: TraceStore;
  causality: Causality;
  recording: boolean;
  /**
   * Optional worker-backed client. When present, session export/import and
   * navigation segment stitch go through the trace worker.
   */
  traceClient?: TraceClient;
  /** @deprecated Recording is always on; pause control has been removed. */
  onToggleRecording?: () => void;
  embedded?: boolean;
  /**
   * Highlight a component's DOM on the page (bidirectional selection). With
   * `reveal`, the page also scrolls to the component when it's out of view —
   * the panel only asks for that on selection, never on hover.
   */
  onHighlight?: (id: ComponentId | null, opts?: { reveal?: boolean }) => void;
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
  traceClient,
  embedded,
  onHighlight,
  overlayEnabled,
  onToggleOverlay,
  timeTravel,
  inspecting = false,
  onToggleInspect,
  selectComponent,
  onSelectConsumed,
  edit,
  onRequestSnapshot,
}: PanelProps) {
  // Re-render on every ingest, and take every store read below through the
  // version. The store mutates in place, so its identity never moves: a read
  // the Compiler memoizes on `store` alone would serve the mount's answer for
  // the rest of the session and make every later event look lost.
  const version = useTraceVersion(store, { kind: "global" });
  const [selected, setSelected] = useState<ComponentId | null>(null);
  // Scroll the inspected page to a newly selected component (off-screen only).
  // Persisted so a user who finds it intrusive turns it off once.
  const [revealOnSelect, setRevealOnSelectState] = useState(() => loadPanelPrefs().revealOnSelect);
  const setRevealOnSelect = (next: boolean) => {
    setRevealOnSelectState(next);
    savePanelPrefs({ revealOnSelect: next });
  };
  /** How much history the store keeps — user-tunable in Settings. */
  const [retention, setRetentionState] = useState<Retention>(() => {
    const prefs = loadPanelPrefs();
    return { maxEvents: prefs.maxEvents, maxAgeMs: prefs.maxAgeMs };
  });
  const setRetention = (next: Retention) => {
    setRetentionState(next);
    savePanelPrefs(next);
  };
  useEffect(() => {
    store.configure(retention);
  }, [store, retention]);
  /**
   * The one writer for selection: every pick — tree, ⌘K, timeline, relations,
   * waste banner, page inspect — flows through here so reveal can't drift out
   * of sync with what the inspector shows.
   */
  const select = useCallback(
    (id: ComponentId) => {
      setSelected(id);
      if (revealOnSelect) onHighlight?.(id, { reveal: true });
    },
    [revealOnSelect, onHighlight],
  );
  /**
   * Solo / mute: one filter, honored by every view (timeline lanes, tree rows,
   * region stats). Purely a view filter — the store keeps recording muted
   * lanes, so un-muting brings the full history back.
   */
  const [laneFilter, setLaneFilter] = useState<LaneFilter>(() =>
    deserializeLaneFilter(loadPanelPrefs().laneFilter),
  );
  // Toggles update functionally, never from the render closure: soloing and
  // muting in the same tick must compose, not clobber each other. Persistence
  // is an effect so the updater stays pure.
  useEffect(() => {
    savePanelPrefs({ laneFilter: serializeLaneFilter(laneFilter) });
  }, [laneFilter]);
  const lanes: LaneControls = {
    filter: laneFilter,
    toggleSolo: (key: LaneKey) => setLaneFilter((f) => toggleSolo(f, key)),
    toggleMute: (key: LaneKey) => setLaneFilter((f) => toggleMute(f, key)),
    clear: () => setLaneFilter(EMPTY_LANE_FILTER),
  };
  const lanesFiltered = laneFilterActive(laneFilter);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<
    Array<{ id: string; title: string; eventCount: number }>
  >([]);
  const importRef = useRef<HTMLInputElement>(null);
  /**
   * Opening the file picker is a request, not a DOM poke.
   *
   * Reaching into the input's ref is legal in a handler but not in render,
   * and the command palette's list is *built* during render — so any closure
   * there that touches the ref reads as a render-time access, which makes the
   * whole component uncompilable. Bumping a counter keeps render pure and
   * moves the ref access into the effect, where it belongs.
   */
  const [importRequests, setImportRequests] = useState(0);
  const openImport = () => setImportRequests((n) => n + 1);
  useEffect(() => {
    if (importRequests > 0) importRef.current?.click();
  }, [importRequests]);
  // Global time cursor + A/B marks (redesign §6, §28) — the temporal spine
  // shared by the Timeline, Tree, and Inspector.
  const [cursor, setCursor] = useState<TimeCursor>({ t: 0, mode: "live" });
  // BYOK AI assistant (drawer) + its provider settings popover.
  const [agentOpen, setAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  // Panel color scheme: dark by default, light/system via the header menu.
  const [themePref, setThemePrefState] = useState<ThemePref>(() => loadPanelPrefs().theme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const doctorAnchorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => applyThemePref(themePref), [themePref]);
  const setThemePref = (pref: ThemePref) => {
    setThemePrefState(pref);
    savePanelPrefs({ theme: pref });
  };
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
  const [agentAsk] = useState<{ token: number; question: string } | null>(null);
  const { dockWidth, onDockResize } = useDockResize(embedded);
  const stats = readFresh(version, () => store.stats());
  /** Session length so far — first activity to last activity+duration. */
  const sessionMs = readFresh(version, () => sessionSpanMs(store));

  /**
   * Say when retention has eaten into the session. A timeline that begins
   * mid-session is indistinguishable from an app that was idle, and the caps
   * are tunable in Settings — but only if the user knows they were hit.
   */
  const reportedDrop = useRef(0);
  const { droppedEvents } = readFresh(version, () => store.retention());
  useEffect(() => {
    if (droppedEvents === 0) {
      reportedDrop.current = 0;
      return;
    }
    // Once per order of magnitude: enough to notice, not a running commentary.
    const magnitude = Math.floor(Math.log10(droppedEvents));
    if (magnitude <= reportedDrop.current && reportedDrop.current !== 0) return;
    reportedDrop.current = magnitude;
    reportNotice(
      "retention",
      `The oldest ${droppedEvents.toLocaleString("en-US")} events have left the trace ` +
        `(retention caps). Raise them in Settings to keep more history.`,
    );
  }, [droppedEvents]);

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
    select(selectComponent);
    onSelectConsumed?.();
  }, [selectComponent, onSelectConsumed, select]);

  // Real time travel: while the cursor is historical (and the toggle is on),
  // the page's state follows the playhead. On by default when supported;
  // the toggle persists across sessions.
  const [travelOn, setTravelOn] = useState(() => loadPanelPrefs().travelOn);
  const [travelSupported, setTravelSupported] = useState(false);
  // Set-wide restore feedback while traveling (partial-restore pill + markers).
  const [, setRestoreStatus] = useState<RestoreStatus | null>(null);
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
    // `setRestoreStatus` is a stable setter, but listing it lets the Compiler
    // verify this memo instead of giving up on the whole component.
    [store, timeTravel, setRestoreStatus],
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
  /** Common post-import state: fresh cursor, no marks. Capture stays on. */
  const enterSessionView = (label: string) => {
    setSelected(null);
    setCursor({ t: 0, mode: "live" });
    setSessionLabel(label);
  };

  const downloadActiveSession = () => {
    if (traceClient) {
      void traceClient
        .exportSession({
          title: "react-lens-session.json",
          pageUrl: typeof location !== "undefined" ? location.href : undefined,
        })
        .then((session) => {
          const body = JSON.stringify(session, null, 2);
          const blob = new Blob([body], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "react-lens-session.json";
          a.click();
          URL.revokeObjectURL(url);
          void saveSessionToIdb(session).catch(() => {
            /* IDB optional */
          });
        });
      return;
    }
    downloadSession(store);
  };

  const loadSessionFile = async (file: File): Promise<LensSessionFile> => {
    if (traceClient) {
      const text = await file.text();
      const session = parseSessionFile(text);
      await traceClient.importSession(session);
      await saveSessionToIdb(session).catch(() => {
        /* ignore */
      });
      return session;
    }
    return importSessionFromFile(store, file);
  };
  useEffect(() => {
    travelCtl?.onCursor(cursor, travelOn && travelSupported && !offlineSession);
  }, [travelCtl, cursor, travelOn, travelSupported, offlineSession]);

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
  // Do NOT clear `sessionLabel` here: import clears then re-ingests, and wiping
  // the offline flag in that gap re-enables travel on imported sessions.
  const empty = stats.events === 0;
  useEffect(() => {
    if (empty) {
      setCursor({ t: 0, mode: "live" });
      setSelected(null);
    }
  }, [empty]);

  // The synchronous pass only runs where the worker could not be spawned, and
  // only for small apps; it is still the most expensive read on this path.
  const fallback = readFresh(version, () =>
    !doctorClient && stats.components <= 2000 ? diagnoseAll(store, causality) : null,
  );
  const affected = workerDoctor?.affected ?? fallback?.affected ?? new Set<ComponentId>();
  const issueCount = workerDoctor?.count ?? fallback?.diagnostics.length ?? 0;
  const diagnostics = workerDoctor?.diagnostics ?? fallback?.diagnostics?.slice(0, 50) ?? [];
  const openDoctor = () => {
    setMenuOpen(false);
    setDoctorOpen((v) => !v);
  };
  const pickDoctorIssue = (id: ComponentId) => {
    select(id);
    setDoctorOpen(false);
    // Tree watchlist rows + Doctor section scroll into view when present.
    requestAnimationFrame(() => {
      document.querySelector(`.node[data-component="${id}"]`)?.scrollIntoView({ block: "nearest" });
      document.querySelector(".isect .rl-doctor")?.closest(".isect")?.scrollIntoView({
        block: "nearest",
      });
    });
  };

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleInspect]);

  useEffect(() => {
    if (!paletteOpen) return;
    void listRecentSessions().then(setRecentSessions);
  }, [paletteOpen]);

  const goLive = () => {
    // Read at click time, not render time: the handler needs the newest commit,
    // not whichever one existed when this closure was created.
    const t = store.commits().at(-1)?.timestamp ?? 0;
    setCursor({ t, mode: "live" });
  };

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
  if (lanesFiltered) {
    commands.push({
      id: "clear-lane-filter",
      label: "Show all lanes (clear solo/mute)",
      hint: `${laneFilter.solo.size + laneFilter.muted.size}`,
      group: "Timeline",
      run: lanes.clear,
    });
  }
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
  commands.push({
    id: "export-session",
    label: "Export session",
    hint: "↓",
    group: "Session",
    run: downloadActiveSession,
  });
  commands.push({
    id: "import-session",
    label: "Import session",
    hint: "↑",
    group: "Session",
    run: openImport,
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
          if (traceClient) void traceClient.importSession(file);
          else importSession(store, file);
          enterSessionView(file.meta?.title ?? entry.title);
        });
      },
    });
  }

  return (
    <div
      ref={rootRef}
      className={`rl-root rl-redesign${embedded ? " rl-embedded" : ""}`}
      style={embedded && dockWidth ? { width: dockWidth } : undefined}
    >
      {embedded && (
        <div
          className="rl-resize-handle"
          title="Drag to resize the panel"
          onPointerDown={onDockResize}
        />
      )}
      <RedesignShell
        store={store}
        causality={causality}
        recording={recording}
        cursor={cursor}
        onCursor={setCursor}
        lanes={lanes}
        doctor={affected}
        selected={selected}
        onSelect={select}
        sessionSpanMs={sessionMs}
        {...(onHighlight ? { onHighlight } : {})}
        {...(edit ? { edit } : {})}
        {...(onRequestSnapshot ? { onRequestSnapshot } : {})}
        transport={
          timeTravel ? (
            <button
              type="button"
              className={`rl-icon-btn rl-tl-travel${travelOn ? " active" : ""}`}
              disabled={!travelSupported || offlineSession}
              title={
                offlineSession
                  ? "Imported session — time travel needs the original live page. Resume recording to go back live."
                  : !travelSupported
                    ? "Time travel requires a development React build"
                    : travelOn
                      ? "Time travel on — the page follows the playhead"
                      : "Time travel off — scrubbing only moves the panel views"
              }
              aria-label="Apply state to the page while scrubbing"
              aria-pressed={travelOn}
              onClick={() => {
                setTravelOn((on) => {
                  savePanelPrefs({ travelOn: !on });
                  return !on;
                });
              }}
            >
              <IconRewind size={13} />
            </button>
          ) : undefined
        }
        toolbarActions={
          <span className="rl-toolbar-actions">
            <ErrorChip />
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
              onClick={downloadActiveSession}
              title="Export session"
              aria-label="Export session"
            >
              <IconDownload size={14} />
            </button>
            <button
              className="rl-icon-btn"
              onClick={openImport}
              title="Import session"
              aria-label="Import session"
            >
              <IconUpload size={14} />
            </button>
            {issueCount > 0 && (
              <span className="rl-menu-anchor" ref={doctorAnchorRef}>
                <button
                  type="button"
                  className={`rl-icon-btn rl-doctor-btn${doctorOpen ? " active" : ""}`}
                  onClick={openDoctor}
                  title={`${issueCount} Doctor issues`}
                  aria-label={`${issueCount} Doctor issues`}
                  aria-haspopup="dialog"
                  aria-expanded={doctorOpen}
                >
                  <IconDoctor size={14} />
                  <span className="rl-doctor-badge">{issueCount}</span>
                </button>
                {doctorOpen && (
                  <DoctorIssuesMenu
                    diagnostics={diagnostics}
                    issueCount={issueCount}
                    store={store}
                    anchorRef={doctorAnchorRef}
                    onSelect={pickDoctorIssue}
                    onClose={() => setDoctorOpen(false)}
                  />
                )}
              </span>
            )}
            {lanesFiltered && (
              <button
                className="rl-icon-btn rl-filtered-chip"
                onClick={lanes.clear}
                title={`Views are filtered — ${laneFilter.solo.size} soloed, ${laneFilter.muted.size} muted. Click to show all lanes.`}
              >
                filtered
              </button>
            )}
            <span className="rl-menu-anchor">
              <button
                className={`rl-icon-btn${menuOpen ? " active" : ""}`}
                onClick={() => {
                  setDoctorOpen(false);
                  setMenuOpen((v) => !v);
                }}
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
                reveal={
                  onHighlight
                    ? { enabled: revealOnSelect, toggle: () => setRevealOnSelect(!revealOnSelect) }
                    : undefined
                }
                retention={retention}
                onRetentionChange={setRetention}
                reading={embedded ? "embedded" : "devtools"}
              />
            </span>
            <span
              className={`rl-icon-btn recording severe${recording ? " active" : ""}`}
              title="Recording is always on"
              aria-label="Recording is always on"
              aria-pressed={recording}
            >
              <span className="rl-rec-pulse" />
            </span>
          </span>
        }
      />

      {/* Status bar: the panel's at-a-glance counters. Kept below the concept's
          three columns — it's the one piece of v1 chrome the concept has no
          equivalent for, and it's load-bearing (event counts, Doctor issues). */}
      <div className="rl-statusbar">
        <span
          className="rl-status-metric"
          title="Events captured this session (renders, commits, interactions, effects)"
        >
          <span className="rl-status-k">ev</span> {stats.events}
        </span>
        <span className="rl-status-metric" title="Renders recorded">
          <span className="rl-status-k">rnd</span> {stats.renders}
        </span>
        <span className="rl-status-metric" title="Components seen">
          <span className="rl-status-k">cmp</span> {stats.components}
        </span>
        {issueCount > 0 && (
          <button
            type="button"
            className="rl-status-metric rl-status-doctor rl-status-action"
            title="Doctor issues"
            onClick={openDoctor}
            aria-expanded={doctorOpen}
          >
            <span className="rl-doctor-btn">
              <IconDoctor size={11} />
              <span className="rl-doctor-badge">{issueCount}</span>
            </span>
          </button>
        )}
        <span className="rl-spacer" />
        <span
          className={`rl-status-metric rl-status-rec${recording ? " on" : ""}`}
          title="Recording is always on"
        >
          <span className="rl-status-rec-dot" />
          {recording ? `rec · ${(sessionMs / 1000).toFixed(1)} s` : "paused"}
        </span>
      </div>

      <input
        ref={importRef}
        type="file"
        accept="application/json,.json,.lens.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void loadSessionFile(file)
            .then((session) => {
              enterSessionView(session.meta?.title ?? file.name);
            })
            .catch(() => {
              /* invalid file — ignore for MVP */
            });
        }}
      />

      {paletteOpen && (
        <CommandPalette
          store={store}
          commands={commands}
          onSelectComponent={select}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      <ErrorBoundary scope="agent">
        <AgentPane
          open={agentOpen}
          store={store}
          causality={causality}
          settings={agentSettings}
          settingsVersion={settingsVersion}
          askRequest={agentAsk}
          onClose={() => setAgentOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onSelectComponent={select}
          onCursor={setCursor}
        />
      </ErrorBoundary>
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

const DOCK_MIN = 720;
/** Leave at least this much of the inspected page visible. */
const DOCK_PAGE_MARGIN = 160;

/**
 * Drag-to-resize for the right-docked embedded panel. The handle sits on the
 * panel's left edge, so dragging left widens it.
 */
function useDockResize(embedded?: boolean): {
  dockWidth: number | null;
  onDockResize: (e: React.PointerEvent<HTMLDivElement>) => void;
} {
  const [dockWidth, setDockWidth] = useState<number | null>(() => loadPanelPrefs().dockWidth);
  const latest = useLatest(dockWidth);

  const onDockResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!embedded) return;
    e.preventDefault();
    document.body.style.userSelect = "none";
    // Window-level so the drag survives leaving the 7px handle.
    const move = (ev: PointerEvent) => {
      const max = window.innerWidth - DOCK_PAGE_MARGIN;
      setDockWidth(Math.max(DOCK_MIN, Math.min(max, window.innerWidth - ev.clientX)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      if (latest.current != null) savePanelPrefs({ dockWidth: latest.current });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { dockWidth, onDockResize };
}
