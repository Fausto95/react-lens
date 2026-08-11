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
   * Replay scrolls the timeline to keep the playhead in view. Off by default:
   * above "fit" the content moves under you, which makes it hard to read a
   * cascade while it plays.
   */
  replayFollow: boolean;
  /**
   * Solo / mute lanes. View-only (the store keeps recording muted lanes), but
   * persisted so a noisy component stays hidden across reloads.
   */
  laneFilter: SerializedLaneFilter;
}

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
  replayFollow: false,
  laneFilter: serializeLaneFilter(EMPTY_LANE_FILTER),
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
      replayFollow:
        typeof parsed.replayFollow === "boolean" ? parsed.replayFollow : DEFAULTS.replayFollow,
      // Round-tripped through the filter's own parser so a corrupt entry
      // degrades to "show everything" instead of hiding lanes forever.
      laneFilter: serializeLaneFilter(deserializeLaneFilter(parsed.laneFilter)),
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
