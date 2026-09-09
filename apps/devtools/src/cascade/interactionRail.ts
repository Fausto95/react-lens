import {
  interactionKindLabel,
  type Interaction,
  type InteractionKind,
} from "@reactlens/trace-engine";
import { ms, timeAxis } from "@reactlens/ui";

/**
 * The interactions rail, as data.
 *
 * The rail's job is to make the interaction that matters findable among the
 * ones that don't, in as little width as possible. So a row carries only a
 * label and a cost, cost is expressed as a share (the view paints it as the
 * row's own background rather than spending a column on a bar), and everything
 * else a developer might want lands in one tooltip.
 *
 * Pure: plain data in, plain data out, no React and no DOM.
 */

export type RailSortKey = "time" | "slowest" | "wasted";

export interface RailSort {
  label: string;
  /** Long form for the control's tooltip. */
  title: string;
}

export const RAIL_SORTS: Record<RailSortKey, RailSort> = {
  time: { label: "Time", title: "Session order — oldest first" },
  slowest: { label: "Slow", title: "Most React time first" },
  wasted: { label: "Waste", title: "Most wasted renders first" },
};

/**
 * Session order. A session is a story you read forwards, and "follow latest"
 * means the newest lands at the bottom — reversing that by default would move
 * the thing you are watching every time an interaction arrives.
 */
export const DEFAULT_RAIL_SORT: RailSortKey = "time";

/** Above this share of the session's worst interaction, a row reads as hot. */
const HOT_SHARE = 0.1;

export interface RailRow {
  id: string;
  label: string;
  kind: InteractionKind;
  /** React self time, in ms. */
  cost: number;
  /** `cost` as a share of the most expensive interaction in view, 0..1. */
  costShare: number;
  hot: boolean;
  wasted: number;
  selected: boolean;
  /** Everything the row itself no longer shows. */
  detail: string;
}

function costOf(item: Interaction): number {
  return item.metrics.reactDuration;
}

/**
 * Sorted copy — never the caller's array, because the rail re-sorts on every
 * render and the window it was handed is shared with the transport.
 */
export function railSortOrder(
  interactions: readonly Interaction[],
  wasteById: ReadonlyMap<string, number>,
  sort: RailSortKey,
): Interaction[] {
  const chronological = (a: Interaction, b: Interaction) => a.start - b.start;
  // Ranked sorts break ties by *recency*, since the newest of two equals is the
  // one you just caused.
  const newestFirst = (a: Interaction, b: Interaction) => b.start - a.start;
  const compare: Record<RailSortKey, (a: Interaction, b: Interaction) => number> = {
    time: chronological,
    slowest: (a, b) => costOf(b) - costOf(a) || newestFirst(a, b),
    wasted: (a, b) =>
      (wasteById.get(b.id) ?? 0) - (wasteById.get(a.id) ?? 0) ||
      costOf(b) - costOf(a) ||
      newestFirst(a, b),
  };
  return [...interactions].sort(compare[sort]);
}

/**
 * Wall span is only worth reporting when it clearly exceeds summed React time.
 * Render events often share a commit timestamp, so the span can be a few ms
 * while self time sums to tens — showing both looks like the numbers disagree.
 */
export function extraWallMs(item: Interaction): number | null {
  const extra = item.metrics.totalDuration - item.metrics.reactDuration;
  return extra >= 8 ? item.metrics.totalDuration : null;
}

function detailOf(item: Interaction, wasted: number, t0: number): string {
  const wall = extraWallMs(item);
  const parts = [
    `${item.label} · ${interactionKindLabel(item)}`,
    `${ms(item.metrics.reactDuration)} React${wall == null ? "" : ` · ${ms(wall)} wall`}`,
    `${item.metrics.renderCount.toLocaleString()} renders${
      wasted > 0 ? ` · ${wasted.toLocaleString()} wasted` : ""
    }`,
    `${item.metrics.componentIds.length.toLocaleString()} components · ${item.commitIds.length.toLocaleString()} ${
      item.commitIds.length === 1 ? "commit" : "commits"
    }${item.metrics.stateUpdates > 1 ? ` · ${item.metrics.stateUpdates.toLocaleString()} state` : ""}`,
    `at ${timeAxis(Math.max(0, item.start - t0))}`,
  ];
  return parts.join("\n");
}

export function buildRailRows(
  interactions: readonly Interaction[],
  wasteById: ReadonlyMap<string, number>,
  sort: RailSortKey,
  selectedId: string | null = null,
  t0 = 0,
): RailRow[] {
  const ordered = railSortOrder(interactions, wasteById, sort);
  // Scaled against what is in view, so the fill stays meaningful when the
  // window slides over a long session.
  const worst = Math.max(0, ...ordered.map(costOf));
  return ordered.map((item) => {
    const cost = costOf(item);
    const wasted = wasteById.get(item.id) ?? 0;
    const costShare = worst > 0 ? cost / worst : 0;
    return {
      id: item.id,
      label: item.label,
      kind: item.kind,
      cost,
      costShare,
      hot: worst > 0 && costShare >= HOT_SHARE,
      wasted,
      selected: item.id === selectedId,
      detail: detailOf(item, wasted, t0),
    };
  });
}

/** Kind pip tone for the rail — gesture / load / system. */
export function interactionKindTone(kind: InteractionKind): "gesture" | "load" | "system" {
  if (kind === "load") return "load";
  if (kind === "system") return "system";
  return "gesture";
}
