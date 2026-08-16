import { useEffect, useState } from "react";
import { applyThemePref, loadThemePref, saveThemePref, type ThemePref } from "./theme.js";

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M13 9.2A5.5 5.5 0 0 1 6.8 3 5.5 5.5 0 1 0 13 9.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function resolvedMode(pref: ThemePref): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Icon-only sun/moon toggle between light and dark. */
export function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark">(() =>
    typeof window === "undefined" ? "dark" : resolvedMode(loadThemePref()),
  );

  useEffect(() => applyThemePref(mode), [mode]);

  const toggle = () => {
    const next = mode === "light" ? "dark" : "light";
    saveThemePref(next);
    setMode(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={mode === "light" ? "Switch to dark theme" : "Switch to light theme"}
      title={mode === "light" ? "Switch to dark" : "Switch to light"}
    >
      {mode === "light" ? <IconSun /> : <IconMoon />}
    </button>
  );
}
