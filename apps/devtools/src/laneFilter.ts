import type { ComponentId } from "@reactlens/protocol";

/**
 * Stable lane identities for region heat / Cascade selection.
 * Keys survive remounts (type name, not fiber id).
 */
export type LaneKey = string;

const TYPE_PREFIX = "t:";
const INSTANCE_PREFIX = "i:";
const INSTANCE_SEP = "#";

/** One lane per component type — the default granularity. */
export function typeLaneKey(name: string): LaneKey {
  return TYPE_PREFIX + name;
}

/** A sub-lane for one instance of a repeated component type. */
export function instanceLaneKey(name: string, id: ComponentId): LaneKey {
  return `${INSTANCE_PREFIX}${name}${INSTANCE_SEP}${String(id)}`;
}

/**
 * The type lane an instance lane hangs under, or null at the top. Parsed from
 * the key itself — split at the LAST separator, since names may contain one.
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
