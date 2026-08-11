/**
 * Small persisted panel preferences (localStorage; distinct from the agent's
 * provider settings in settings.ts, which may live in chrome.storage.session).
 */
export interface PanelPrefs {
  /** Real time travel follows the playhead while scrubbing. */
  travelOn: boolean;
}

const KEY = "react-lens/panel-prefs";

const DEFAULTS: PanelPrefs = { travelOn: true };

export function loadPanelPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return {
      travelOn: typeof parsed.travelOn === "boolean" ? parsed.travelOn : DEFAULTS.travelOn,
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
