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
    case "map": {
      const a = after as Extract<SerializedValue, { k: "map" }>;
      if (before.identity === a.identity) {
        return [{ path, kind: "UNCHANGED", confidence: 1 }];
      }
      // Map keys are values — compare entry lists by index for a usable summary.
      const beforeEntries = before.entries ?? [];
      const afterEntries = a.entries ?? [];
      const childChanges: DiffChange[] = [];
      const n = Math.max(beforeEntries.length, afterEntries.length);
      for (let i = 0; i < n; i++) {
        const b = beforeEntries[i];
        const av = afterEntries[i];
        const childPath = [...path, i];
        if (!b && av) {
          childChanges.push({ path: childPath, kind: "ADDED", after: av[1], confidence: 1 });
        } else if (b && !av) {
          childChanges.push({ path: childPath, kind: "REMOVED", before: b[1], confidence: 1 });
        } else if (b && av) {
          childChanges.push(...compareValue(b[0], av[0], [...childPath, "key"]));
          childChanges.push(...compareValue(b[1], av[1], [...childPath, "value"]));
        }
      }
      const structurallyChanged = childChanges.some((c) => c.kind !== "UNCHANGED");
      return [
        {
          path,
          kind: structurallyChanged ? "STRUCTURE_CHANGED" : "REFERENCE_ONLY_CHANGED",
          before,
          after,
          confidence: 1,
        },
        ...childChanges,
      ];
    }
    case "set": {
      const a = after as Extract<SerializedValue, { k: "set" }>;
      if (before.identity === a.identity) {
        return [{ path, kind: "UNCHANGED", confidence: 1 }];
      }
      return compareEntries(
        indexedEntries(before.values),
        indexedEntries(a.values),
        path,
        before,
        after,
      );
    }
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
