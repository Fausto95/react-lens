import { THEME_PREFS, type ThemePref } from "./theme.js";
import {
  EMPTY_LANE_FILTER,
  deserializeLaneFilter,
  serializeLaneFilter,
  type SerializedLaneFilter,
} from "./laneFilter.js";

/**
 * Small persisted panel preferences (localStorage; distinct from the agent's
 * provider settings in settings.ts, which may live in chrome.storage.session).
 */
export interface PanelPrefs {
  /** Real time travel follows the playhead while scrubbing. */
  travelOn: boolean;
  /** Timeline pane: waterfall-lane height (px) and collapsed state. */
  tlPaneH: number;
  tlCollapsed: boolean;
  /** Panel color scheme; dark is the historical default. */
  theme: ThemePref;
  /** Embedded dock width (px); null keeps the CSS default. */
  dockWidth: number | null;
  /** Column widths (px) for the components and inspector panes; the timeline
   *  takes whatever is left. */
  treeWidth: number;
  inspectorWidth: number;
  /** Side panes collapsed to a rail; each keeps its width for when it returns. */
  treeCollapsed: boolean;
  inspectorCollapsed: boolean;
  /** Selecting a component scrolls the inspected page to it when off-screen. */
  revealOnSelect: boolean;
  /**
   * Solo / mute lanes. View-only (the store keeps recording muted lanes), but
   * persisted so a noisy component stays hidden across reloads.
   */
  laneFilter: SerializedLaneFilter;
  /** How many events the trace store retains before dropping the oldest. */
  maxEvents: number;
  /**
   * Keep only the last N ms of activity. Null keeps whatever `maxEvents`
   * allows. A count alone is a poor fit for an app that churns in the
   * background — it trades the interesting minute for a thousand idle commits.
   */
  maxAgeMs: number | null;
}

/** Below this the ring is useless; above it the panel starts eating memory. */
export const MIN_MAX_EVENTS = 1_000;
export const MAX_MAX_EVENTS = 500_000;

const KEY = "react-lens/panel-prefs";

const DEFAULTS: PanelPrefs = {
  travelOn: true,
  tlPaneH: 250,
  tlCollapsed: false,
  theme: "dark",
  dockWidth: null,
  treeWidth: 272,
  inspectorWidth: 320,
  treeCollapsed: false,
  inspectorCollapsed: false,
  revealOnSelect: true,
  laneFilter: serializeLaneFilter(EMPTY_LANE_FILTER),
  maxEvents: 10_000,
  maxAgeMs: null,
};

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function loadPanelPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return {
      travelOn: typeof parsed.travelOn === "boolean" ? parsed.travelOn : DEFAULTS.travelOn,
      tlPaneH: typeof parsed.tlPaneH === "number" ? parsed.tlPaneH : DEFAULTS.tlPaneH,
      tlCollapsed:
        typeof parsed.tlCollapsed === "boolean" ? parsed.tlCollapsed : DEFAULTS.tlCollapsed,
      theme: THEME_PREFS.includes(parsed.theme as ThemePref)
        ? (parsed.theme as ThemePref)
        : DEFAULTS.theme,
      dockWidth:
        typeof parsed.dockWidth === "number" && Number.isFinite(parsed.dockWidth)
          ? parsed.dockWidth
          : DEFAULTS.dockWidth,
      treeWidth: num(parsed.treeWidth, DEFAULTS.treeWidth, 180, 460),
      inspectorWidth: num(parsed.inspectorWidth, DEFAULTS.inspectorWidth, 240, 560),
      treeCollapsed:
        typeof parsed.treeCollapsed === "boolean" ? parsed.treeCollapsed : DEFAULTS.treeCollapsed,
      inspectorCollapsed:
        typeof parsed.inspectorCollapsed === "boolean"
          ? parsed.inspectorCollapsed
          : DEFAULTS.inspectorCollapsed,
      revealOnSelect:
        typeof parsed.revealOnSelect === "boolean"
          ? parsed.revealOnSelect
          : DEFAULTS.revealOnSelect,
      // Round-tripped through the filter's own parser so a corrupt entry
      // degrades to "show everything" instead of hiding lanes forever.
      laneFilter: serializeLaneFilter(deserializeLaneFilter(parsed.laneFilter)),
      maxEvents: num(parsed.maxEvents, DEFAULTS.maxEvents, MIN_MAX_EVENTS, MAX_MAX_EVENTS),
      maxAgeMs:
        typeof parsed.maxAgeMs === "number" && Number.isFinite(parsed.maxAgeMs)
          ? parsed.maxAgeMs > 0
            ? parsed.maxAgeMs
            : null
          : DEFAULTS.maxAgeMs,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePanelPrefs(patch: Partial<PanelPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPanelPrefs(), ...patch }));
  } catch {
    /* storage unavailable (sandboxed iframe) — prefs simply don't persist */
  }
}
