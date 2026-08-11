import type { SerializedValue } from "@reactlens/protocol";
import type { DiffChange, ChangeKind } from "./types.js";

type Path = Array<string | number>;

/** Confidence that a function change is behaviorally meaningful: unknown. */
const FN_CONFIDENCE = 0.5;

/**
 * Recursively compares two serialized values, emitting a flat list of changes
 * keyed by path. Emits a single entry for leaves; for containers, emits a
 * top-level entry (its overall verdict) followed by child entries.
 */
export function compareValue(
  before: SerializedValue,
  after: SerializedValue,
  path: Path = [],
): DiffChange[] {
  // Reference short-circuit: same identity ⇒ provably the same reference.
  if ("identity" in before && "identity" in after && before.k === after.k) {
    if (before.identity === after.identity) {
      return [{ path, kind: "UNCHANGED", confidence: 1 }];
    }
  }

  if (before.k !== after.k) {
    return [{ path, kind: "STRUCTURE_CHANGED", before, after, confidence: 1 }];
  }

  switch (before.k) {
    case "primitive": {
      const a = after as Extract<SerializedValue, { k: "primitive" }>;
      const same = before.type === a.type && before.value === a.value;
      return [
        {
          path,
          kind: same ? "UNCHANGED" : "VALUE_CHANGED",
          before,
          after,
          confidence: 1,
        },
      ];
    }
    case "null":
    case "undefined":
      return [{ path, kind: "UNCHANGED", confidence: 1 }];
    case "bigint": {
      const a = after as Extract<SerializedValue, { k: "bigint" }>;
      return [leaf(path, before.value === a.value, before, after)];
    }
    case "date": {
      const a = after as Extract<SerializedValue, { k: "date" }>;
      return [leaf(path, before.iso === a.iso, before, after)];
    }
    case "regexp": {
      const a = after as Extract<SerializedValue, { k: "regexp" }>;
      return [leaf(path, before.source === a.source && before.flags === a.flags, before, after)];
    }
    case "function":
      // identities already known unequal here
      return [
        { path, kind: "FUNCTION_IDENTITY_CHANGED", before, after, confidence: FN_CONFIDENCE },
      ];
    case "symbol":
    case "dom":
    case "react-element":
    case "ref":
      // identity already unequal (or missing) — treat as a reference change
      return [{ path, kind: "REFERENCE_ONLY_CHANGED", before, after, confidence: 1 }];
    case "array":
      return compareEntries(
        indexedEntries(before.items),
        indexedEntries((after as Extract<SerializedValue, { k: "array" }>).items),
        path,
        before,
        after,
      );
    case "object":
      return compareEntries(
        keyedEntries(before.entries),
        keyedEntries((after as Extract<SerializedValue, { k: "object" }>).entries),
        path,
        before,
        after,
      );
    case "map":
    case "set":
      // Structural map/set diff is deferred; report reference change only.
      return [{ path, kind: "REFERENCE_ONLY_CHANGED", before, after, confidence: 1 }];
    default:
      // Exhaustive over SerializedValue["k"]; keeps the compiler satisfied.
      return [{ path, kind: "UNCHANGED", confidence: 1 }];
  }
}

function leaf(
  path: Path,
  same: boolean,
  before: SerializedValue,
  after: SerializedValue,
): DiffChange {
  return { path, kind: same ? "UNCHANGED" : "VALUE_CHANGED", before, after, confidence: 1 };
}

function indexedEntries(items?: SerializedValue[]): Map<string | number, SerializedValue> {
  const m = new Map<string | number, SerializedValue>();
  items?.forEach((v, i) => m.set(i, v));
  return m;
}

function keyedEntries(
  entries?: Array<[string, SerializedValue]>,
): Map<string | number, SerializedValue> {
  const m = new Map<string | number, SerializedValue>();
  entries?.forEach(([k, v]) => m.set(k, v));
  return m;
}

function compareEntries(
  before: Map<string | number, SerializedValue>,
  after: Map<string | number, SerializedValue>,
  path: Path,
  beforeVal: SerializedValue,
  afterVal: SerializedValue,
): DiffChange[] {
  const childChanges: DiffChange[] = [];
  const keys = new Set<string | number>([...before.keys(), ...after.keys()]);

  for (const key of keys) {
    const b = before.get(key);
    const a = after.get(key);
    const childPath = [...path, key];
    if (b === undefined && a !== undefined) {
      childChanges.push({ path: childPath, kind: "ADDED", after: a, confidence: 1 });
    } else if (b !== undefined && a === undefined) {
      childChanges.push({ path: childPath, kind: "REMOVED", before: b, confidence: 1 });
    } else if (b !== undefined && a !== undefined) {
      childChanges.push(...compareValue(b, a, childPath));
    }
  }

  const structurallyChanged = childChanges.some((c) => c.kind !== "UNCHANGED");
  const topKind: ChangeKind = structurallyChanged ? "STRUCTURE_CHANGED" : "REFERENCE_ONLY_CHANGED";

  return [
    { path, kind: topKind, before: beforeVal, after: afterVal, confidence: 1 },
    ...childChanges,
  ];
}
