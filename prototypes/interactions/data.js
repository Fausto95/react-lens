/**
 * Interactions shaped like the real `Interaction` the rail receives:
 * label, kind, self time, wall span, render count, wasted count.
 *
 * Modelled on real sessions — a huge `Load`, a few cheap gestures, one
 * expensive click, and a long tail. The point of the data is the *spread*: the
 * rail's job is to make the one that matters findable among the ones that don't.
 */
export const KINDS = {
  gesture: { label: "gesture", color: "var(--cause-props)" },
  load: { label: "load", color: "var(--cause-state)" },
  system: { label: "system", color: "var(--cause-parent)" },
};

const RAW = [
  ["Load", "load", 336.0, 1215, 2338, 0, 1847, 27, 232],
  ["App + MoviesScreen", "system", 25.8, 31, 47, 0, 47, 1, 2],
  ["click FilterChip", "gesture", 4.68, 12, 10, 0, 10, 1, 1],
  ["click MovieCard", "gesture", 44.7, 88, 9, 6, 9, 1, 1],
  ["input SearchField", "gesture", 2.1, 9, 6, 4, 6, 1, 1],
  ["input SearchField", "gesture", 1.9, 8, 6, 4, 6, 1, 1],
  ["input SearchField", "gesture", 2.4, 9, 6, 5, 6, 1, 1],
  ["scroll Catalog", "gesture", 18.3, 240, 412, 380, 206, 12, 0],
  ["click ThemeToggle", "gesture", 12.6, 20, 74, 2, 61, 2, 1],
  ["SidePanelWorkflow", "system", 0.3, 1, 1, 0, 1, 1, 0],
  ["click Save", "gesture", 6.4, 14, 21, 11, 18, 2, 3],
  ["visibilitychange", "system", 0.2, 1, 2, 0, 2, 1, 0],
  ["click Continue", "gesture", 51.2, 96, 138, 96, 92, 4, 2],
  ["resize", "system", 3.8, 6, 33, 30, 33, 1, 0],
];

export const INTERACTIONS = RAW.map(
  ([label, kind, selfMs, wallMs, renders, wasted, comps, commits, states], i) => ({
    id: `i${i}`,
    label,
    kind,
    selfMs,
    wallMs,
    renders,
    wasted,
    comps,
    commits,
    states,
    /** Wall-clock offset from session start, ms. */
    at: i === 0 ? 0 : 1200 + i * 2600 + (i % 3) * 700,
  }),
);

export const MAX_SELF = Math.max(...INTERACTIONS.map((i) => i.selfMs));

/** The rows a lens would show — enough to judge how much width the rail costs. */
export const LEDGER_ROWS = [
  [0, "App", "state", 0.4],
  [1, "MovieDetailDialog", "parent", 0.2],
  [1, "CommandPalette", "parent", 0.1],
  [0, "MoviesScreen", "context", 1.9],
  [1, "Featured", "parent", 0.7],
  [2, "MoviePoster", "parent", 0.3],
  [1, "ContinueRail", "parent", 0.1],
  [1, "MovieRow", "parent", 8.7],
  [2, "MoviePoster", "props", 3.0],
  [2, "RatingBadge", "parent", 0.2],
  [1, "FilterGroup", "parent", 0.1],
  [2, "FilterChip", "parent", 0.1],
];

export function fmtMs(value) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function fmtCount(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/** Session-relative time, as the rail's axis would show it. */
export function fmtAt(value) {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

export const SORTS = {
  recent: { label: "New", compare: (a, b) => b.at - a.at },
  slowest: { label: "Slow", compare: (a, b) => b.selfMs - a.selfMs },
  wasted: { label: "Waste", compare: (a, b) => b.wasted - a.wasted || b.selfMs - a.selfMs },
};
