import type { DOMSnapshot, DOMNodeSnapshot } from "@reactlens/protocol";

const MAX_DEPTH = 6;
const MAX_CHILDREN = 32;
const MAX_TEXT = 120;

export interface SnapshotDomOptions {
  /** Default 6 — the per-render budget. Commit-wide captures pass more. */
  maxDepth?: number;
  maxChildren?: number;
}

/** Serializes a DOM subtree into the structured snapshot the diff engine reads. */
export function snapshotDom(node: Node, options?: SnapshotDomOptions): DOMSnapshot | undefined {
  const limits = {
    maxDepth: options?.maxDepth ?? MAX_DEPTH,
    maxChildren: options?.maxChildren ?? MAX_CHILDREN,
  };
  const root = snapshotNode(node, 0, limits);
  if (!root) return undefined;
  return { root };
}

function snapshotNode(
  node: Node,
  depth: number,
  limits: { maxDepth: number; maxChildren: number },
): DOMNodeSnapshot | undefined {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? "";
    if (!text) return undefined;
    return { nodeName: "#text", text: clip(text) };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined;

  const el = node as Element;
  const snapshot: DOMNodeSnapshot = { nodeName: el.nodeName };

  const attributes = attributesOf(el);
  if (attributes) snapshot.attributes = attributes;

  if (depth >= limits.maxDepth) return snapshot;

  const children: DOMNodeSnapshot[] = [];
  let count = 0;
  for (const child of Array.from(el.childNodes)) {
    if (count >= limits.maxChildren) break;
    const childSnapshot = snapshotNode(child, depth + 1, limits);
    if (childSnapshot) {
      children.push(childSnapshot);
      count++;
    }
  }
  if (children.length) snapshot.children = children;
  else {
    const text = directText(el);
    if (text) snapshot.text = clip(text);
  }
  return snapshot;
}

function attributesOf(el: Element): Record<string, string> | undefined {
  if (!el.attributes.length) return undefined;
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) out[attr.name] = attr.value;
  return out;
}

function directText(el: Element): string {
  let text = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
  }
  return text.trim();
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…" : text;
}
