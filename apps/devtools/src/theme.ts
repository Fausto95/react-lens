/**
 * Theme preference → document. The stylesheet is dark by default; light mode
 * is a token override block under [data-rl-theme="light"] (see theme.css).
 * The attribute lives on the document root so page-level inspect chrome
 * (tooltip, badge) themes along with the panel.
 */

export type ThemePref = "system" | "light" | "dark";

export const THEME_PREFS: readonly ThemePref[] = ["system", "light", "dark"];

export function resolveTheme(pref: ThemePref, systemPrefersLight: boolean): "light" | "dark" {
  return pref === "system" ? (systemPrefersLight ? "light" : "dark") : pref;
}

/** Apply a preference; returns a cleanup that detaches the system listener. */
export function applyThemePref(pref: ThemePref): () => void {
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  const stamp = (prefersLight: boolean) => {
    document.documentElement.dataset.rlTheme = resolveTheme(pref, prefersLight);
  };
  stamp(mq?.matches ?? false);
  if (pref !== "system" || !mq) return () => {};
  const onChange = (e: { matches: boolean }) => stamp(e.matches);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
