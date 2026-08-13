/**
 * Site theme — same document attribute the panel uses (`data-rl-theme`),
 * so the docked React Lens chrome and the marketing page flip together.
 */

export type ThemePref = "system" | "light" | "dark";

export const THEME_PREFS: readonly ThemePref[] = ["system", "light", "dark"];

const STORAGE_KEY = "react-lens/site-theme";
const PANEL_PREFS_KEY = "react-lens/panel-prefs";

export function resolveTheme(pref: ThemePref, systemPrefersLight: boolean): "light" | "dark" {
  return pref === "system" ? (systemPrefersLight ? "light" : "dark") : pref;
}

export function loadThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && THEME_PREFS.includes(raw as ThemePref)) return raw as ThemePref;
  } catch {
    /* private mode */
  }
  return "system";
}

export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* private mode */
  }
  // Keep the docked panel menu in sync when it next reads prefs.
  try {
    const raw = localStorage.getItem(PANEL_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ ...parsed, theme: pref }));
  } catch {
    /* ignore */
  }
}

/** Stamp the resolved theme; returns cleanup for the system listener. */
export function applyThemePref(pref: ThemePref): () => void {
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  const stamp = (prefersLight: boolean) => {
    document.documentElement.dataset.rlTheme = resolveTheme(pref, prefersLight);
  };
  stamp(mq?.matches ?? false);
  if (pref !== "system" || !mq) return () => {};
  const onChange = (e: MediaQueryListEvent) => stamp(e.matches);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
