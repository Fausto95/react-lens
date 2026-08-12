import type { ClipCauseColor } from "../model/lanes.js";

/** Colors read from `.rl-redesign` CSS tokens — canvas cannot inherit theme by itself. */
export interface TimelineTheme {
  bg: string;
  panel: string;
  accent: string;
  props: string;
  state: string;
  context: string;
  cascade: string;
  warn: string;
  bad: string;
  text2: string;
  text3: string;
  line: string;
  lineStrong: string;
  mono: string;
}

const FALLBACK: TimelineTheme = {
  bg: "#0A0A0B",
  panel: "#0F0F11",
  accent: "#6E9BFF",
  props: "#4C8DFF",
  state: "#3ECF8E",
  context: "#A78BFA",
  cascade: "#7A7A85",
  warn: "#F5A623",
  bad: "#F87171",
  text2: "#9A9AA3",
  text3: "#5C5C66",
  line: "rgba(255,255,255,0.07)",
  lineStrong: "rgba(255,255,255,0.12)",
  mono: 'ui-monospace,"SF Mono",Menlo,monospace',
};

export function readTimelineTheme(root: Element | null): TimelineTheme {
  if (!root) return FALLBACK;
  const s = getComputedStyle(root);
  const pick = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
  return {
    bg: pick("--bg", FALLBACK.bg),
    panel: pick("--panel", FALLBACK.panel),
    accent: pick("--accent", FALLBACK.accent),
    props: pick("--props", FALLBACK.props),
    state: pick("--state", FALLBACK.state),
    context: pick("--ctx", FALLBACK.context),
    cascade: pick("--cascade", FALLBACK.cascade),
    warn: pick("--warn", FALLBACK.warn),
    bad: pick("--bad", FALLBACK.bad),
    text2: pick("--text-2", FALLBACK.text2),
    text3: pick("--text-3", FALLBACK.text3),
    line: pick("--line", FALLBACK.line),
    lineStrong: pick("--line-strong", FALLBACK.lineStrong),
    mono: pick("--mono", FALLBACK.mono),
  };
}

export function causeColor(theme: TimelineTheme, cause: ClipCauseColor): string {
  return theme[cause];
}

const CAUSE_CSS: Record<ClipCauseColor, string> = {
  props: "var(--props)",
  state: "var(--state)",
  context: "var(--ctx)",
  cascade: "var(--cascade)",
};

export function causeCssVar(cause: ClipCauseColor): string {
  return CAUSE_CSS[cause];
}

/** `#rrggbb` → `rgba(r,g,b,a)` for canvas fills. */
export function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
