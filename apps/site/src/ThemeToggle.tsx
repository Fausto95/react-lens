import { useEffect, useState, type ReactNode } from "react";
import {
  THEME_PREFS,
  applyThemePref,
  loadThemePref,
  saveThemePref,
  type ThemePref,
} from "./theme.js";

const LABELS: Record<ThemePref, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function IconSystem() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M13 9.2A5.5 5.5 0 0 1 6.8 3 5.5 5.5 0 1 0 13 9.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICONS: Record<ThemePref, () => ReactNode> = {
  system: IconSystem,
  light: IconSun,
  dark: IconMoon,
};

/** Cycles system → light → dark. Stamps data-rl-theme for site + panel. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() =>
    typeof window === "undefined" ? "system" : loadThemePref(),
  );

  useEffect(() => applyThemePref(pref), [pref]);

  const cycle = () => {
    const i = THEME_PREFS.indexOf(pref);
    const next = THEME_PREFS[(i + 1) % THEME_PREFS.length]!;
    saveThemePref(next);
    setPref(next);
  };

  const Icon = ICONS[pref];

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${LABELS[pref]}. Click to change.`}
      title={`Theme: ${LABELS[pref]}`}
    >
      <Icon />
      <span className="theme-toggle-label">{LABELS[pref]}</span>
    </button>
  );
}
