import { THEME_PREFS, type ThemePref } from "./theme.js";

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
  /** Tree/inspector split as a percent of the body width. */
  splitPct: number;
}

const KEY = "react-lens/panel-prefs";

const DEFAULTS: PanelPrefs = {
  travelOn: true,
  tlPaneH: 250,
  tlCollapsed: false,
  theme: "dark",
  dockWidth: null,
  splitPct: 50,
};

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
      splitPct:
        typeof parsed.splitPct === "number" && Number.isFinite(parsed.splitPct)
          ? Math.max(22, Math.min(78, parsed.splitPct))
          : DEFAULTS.splitPct,
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
