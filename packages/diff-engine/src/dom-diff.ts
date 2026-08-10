import type { DOMSnapshot, DOMNodeSnapshot } from "@react-lens/protocol";
import type { DiffChange } from "./types.js";

type Path = Array<string | number>;

/**
 * Structural DOM diff. Only emits entries for actual differences — an empty
 * result means the render produced no observable DOM change, which is the
 * evidence behind a "suspicious render" (DESIGN §6).
 */
export function compareDom(before: DOMSnapshot, after: DOMSnapshot): DiffChange[] {
  const changes: DiffChange[] = [];
  compareNode(before.root, after.root, [], changes);
  return changes;
}

function compareNode(
  before: DOMNodeSnapshot,
  after: DOMNodeSnapshot,
  path: Path,
  out: DiffChange[],
): void {
  if (before.nodeName !== after.nodeName) {
    out.push({
      path: [...path, "nodeName"],
      kind: "VALUE_CHANGED",
      confidence: 1,
    });
    // Different element type — children comparison is meaningless.
    return;
  }

  compareAttributes(before.attributes ?? {}, after.attributes ?? {}, path, out);

  if ((before.text ?? "") !== (after.text ?? "")) {
    out.push({ path: [...path, "#text"], kind: "VALUE_CHANGED", confidence: 1 });
  }

  const beforeChildren = before.children ?? [];
  const afterChildren = after.children ?? [];
  const max = Math.max(beforeChildren.length, afterChildren.length);
  for (let i = 0; i < max; i++) {
    const b = beforeChildren[i];
    const a = afterChildren[i];
    const childPath = [...path, i];
    if (b === undefined && a !== undefined) {
      out.push({ path: childPath, kind: "ADDED", confidence: 1 });
    } else if (b !== undefined && a === undefined) {
      out.push({ path: childPath, kind: "REMOVED", confidence: 1 });
    } else if (b !== undefined && a !== undefined) {
      compareNode(b, a, childPath, out);
    }
  }
}

function compareAttributes(
  before: Record<string, string>,
  after: Record<string, string>,
  path: Path,
  out: DiffChange[],
): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (b === undefined && a !== undefined) {
      out.push({ path: [...path, key], kind: "ADDED", confidence: 1 });
    } else if (b !== undefined && a === undefined) {
      out.push({ path: [...path, key], kind: "REMOVED", confidence: 1 });
    } else if (b !== a) {
      out.push({ path: [...path, key], kind: "VALUE_CHANGED", confidence: 1 });
    }
  }
}
