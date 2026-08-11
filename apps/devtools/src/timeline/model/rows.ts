import type { ComponentId } from "@reactlens/protocol";
import type { LaneKey } from "../../laneFilter.js";
import type { Clip, DensityBucket, Lane } from "./lanes.js";

/**
 * Lanes flattened into the rows the canvas draws, in order.
 *
 * One row per component type, plus a row per instance when a repeated type is
 * expanded. This is the single place row order and heights are decided, so the
 * name gutter and the track can never disagree about which row is which.
 */

export const LANE_H = 34;
export const SUB_H = 26;

export interface LaneRow {
  kind: "lane" | "sub";
  key: LaneKey;
  lane: Lane;
  label: string;
  /** `×200` for a repeated type; null otherwise. */
  suffix: string | null;
  /** Present on instance rows. */
  componentId?: ComponentId;
  /** Clips to draw. Empty on a collapsed group, which shows density instead. */
  clips: readonly Clip[];
  /** Occupancy buckets; only a collapsed group has them. */
  density: readonly DensityBucket[];
  expandable: boolean;
  expanded: boolean;
  height: number;
  /** Distance from the top of the canvas, in px. */
  top: number;
}

export function laneRows(lanes: readonly Lane[], expanded: ReadonlySet<LaneKey>): LaneRow[] {
  const rows: LaneRow[] = [];
  let top = 0;
  const push = (row: Omit<LaneRow, "top">) => {
    rows.push({ ...row, top });
    top += row.height;
  };

  for (const lane of lanes) {
    // A single-instance type has no instance/type distinction to expand into,
    // so it never offers a chevron — type and instance are one concept.
    const expandable = lane.subs.length > 0;
    const open = expandable && expanded.has(lane.key);
    push({
      kind: "lane",
      key: lane.key,
      lane,
      label: lane.name,
      suffix: lane.instanceCount > 1 ? `×${lane.instanceCount}` : null,
      // A repeated type draws a density band; 200 unreadable slivers is noise.
      clips: expandable ? [] : lane.clips,
      density: expandable ? lane.density : [],
      expandable,
      expanded: open,
      height: LANE_H,
    });
    if (!open) continue;
    for (const sub of lane.subs) {
      push({
        kind: "sub",
        key: sub.key,
        lane,
        label: sub.label,
        suffix: null,
        componentId: sub.componentId,
        clips: sub.clips,
        density: [],
        expandable: false,
        expanded: false,
        height: SUB_H,
      });
    }
  }
  return rows;
}

/** Total canvas height for the given rows. */
export function rowsHeight(rows: readonly LaneRow[]): number {
  const last = rows.at(-1);
  return last ? last.top + last.height : 0;
}

/** Lane keys whose instances include any of `ids` — used to reveal a cascade. */
export function lanesContaining(lanes: readonly Lane[], ids: ReadonlySet<ComponentId>): LaneKey[] {
  const out: LaneKey[] = [];
  for (const lane of lanes) {
    if (lane.subs.length === 0) continue;
    if (lane.subs.some((sub) => ids.has(sub.componentId))) out.push(lane.key);
  }
  return out;
}
