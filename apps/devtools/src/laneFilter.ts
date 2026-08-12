import type { ComponentId } from "@reactlens/protocol";

/**
 * Solo / mute as a **view-only** filter over lanes (DASH: DAW semantics).
 *
 * This is panel state, never capture state: muting drops a lane out of every
 * view (timeline, tree, stats) but the trace store keeps recording it, so
 * un-muting restores the full history. Capture-level exclusion, if it ever
 * ships, is a separate and visually distinct mode — never a silent upgrade of
 * mute (see the panel redesign plan, decision 2).
 *
 * Keys are stable identities, not instance ids, so the filter survives
 * remounts and is safe to persist or hand to the page side later.
 */
export type LaneKey = string;

export interface LaneFilter {
  readonly solo: ReadonlySet<LaneKey>;
  readonly muted: ReadonlySet<LaneKey>;
}

export interface SerializedLaneFilter {
  v: 1;
  solo: LaneKey[];
  muted: LaneKey[];
}

/** Why a lane is not drawn — the UI labels mute, but merely dims the rest. */
export type LaneVisibility = "visible" | "muted" | "unsoloed";

export const EMPTY_LANE_FILTER: LaneFilter = { solo: new Set(), muted: new Set() };

const TYPE_PREFIX = "t:";
const INSTANCE_PREFIX = "i:";
const INSTANCE_SEP = "#";

/** One lane per component type — the default granularity of the timeline. */
export function typeLaneKey(name: string): LaneKey {
  return TYPE_PREFIX + name;
}

/** A sub-lane for one instance of a repeated component type. */
export function instanceLaneKey(name: string, id: ComponentId): LaneKey {
  return `${INSTANCE_PREFIX}${name}${INSTANCE_SEP}${String(id)}`;
}

/**
 * The type lane an instance lane hangs under, or null at the top. Parsed from
 * the key itself so the filter needs no lane table to resolve nesting — split
 * at the LAST separator, since component names may contain one.
 */
export function parentLaneKey(key: LaneKey): LaneKey | null {
  if (!key.startsWith(INSTANCE_PREFIX)) return null;
  const body = key.slice(INSTANCE_PREFIX.length);
  const cut = body.lastIndexOf(INSTANCE_SEP);
  if (cut < 0) return null;
  return typeLaneKey(body.slice(0, cut));
}

/** Ancestors first, the lane itself last. */
export function laneChain(key: LaneKey): LaneKey[] {
  const parent = parentLaneKey(key);
  return parent ? [parent, key] : [key];
}

export function laneVisibility(filter: LaneFilter, key: LaneKey): LaneVisibility {
  const chain = laneChain(key);
  // Mute wins over solo: an explicitly silenced lane stays silent.
  if (chain.some((k) => filter.muted.has(k))) return "muted";
  if (filter.solo.size === 0) return "visible";
  // Soloing a lane keeps its ancestors visible (context for the soloed lane)
  // and its descendants visible (the lane is nothing without them).
  if (chain.some((k) => filter.solo.has(k))) return "visible";
  for (const soloed of filter.solo) {
    if (laneChain(soloed).includes(key)) return "visible";
  }
  return "unsoloed";
}

export function isLaneVisible(filter: LaneFilter, key: LaneKey): boolean {
  return laneVisibility(filter, key) === "visible";
}

function toggled(set: ReadonlySet<LaneKey>, key: LaneKey): Set<LaneKey> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function toggleSolo(filter: LaneFilter, key: LaneKey): LaneFilter {
  return { solo: toggled(filter.solo, key), muted: filter.muted };
}

export function toggleMute(filter: LaneFilter, key: LaneKey): LaneFilter {
  return { solo: filter.solo, muted: toggled(filter.muted, key) };
}

export function clearLaneFilter(_filter: LaneFilter): LaneFilter {
  return EMPTY_LANE_FILTER;
}

/** Sorted so persisted state does not churn on set-iteration order. */
export function serializeLaneFilter(filter: LaneFilter): SerializedLaneFilter {
  return {
    v: 1,
    solo: [...filter.solo].sort(),
    muted: [...filter.muted].sort(),
  };
}

function keySet(value: unknown): Set<LaneKey> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((k): k is LaneKey => typeof k === "string"));
}

/**
 * The filter plus its two writers, handed down to every view that honors it.
 * The panel owns the state; tree rows and lane headers only call these.
 */
export interface LaneControls {
  filter: LaneFilter;
  toggleSolo: (key: LaneKey) => void;
  toggleMute: (key: LaneKey) => void;
  clear: () => void;
}

/** True when any lane is hidden — drives the "views are filtered" affordance. */
export function laneFilterActive(filter: LaneFilter): boolean {
  return filter.solo.size > 0 || filter.muted.size > 0;
}

/** Never throws: a corrupt persisted filter degrades to "show everything". */
export function deserializeLaneFilter(raw: unknown): LaneFilter {
  if (!raw || typeof raw !== "object") return EMPTY_LANE_FILTER;
  const obj = raw as Partial<SerializedLaneFilter>;
  return { solo: keySet(obj.solo), muted: keySet(obj.muted) };
}
