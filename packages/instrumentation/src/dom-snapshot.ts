import type { DOMSnapshot, DOMNodeSnapshot } from "@react-lens/protocol";

const MAX_DEPTH = 6;
const MAX_CHILDREN = 32;
const MAX_TEXT = 120;

/** Serializes a DOM subtree into the structured snapshot the diff engine reads. */
export function snapshotDom(node: Node): DOMSnapshot | undefined {
  const root = snapshotNode(node, 0);
  if (!root) return undefined;
  return { root };
}

function snapshotNode(node: Node, depth: number): DOMNodeSnapshot | undefined {
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

  if (depth >= MAX_DEPTH) return snapshot;

  const children: DOMNodeSnapshot[] = [];
  let count = 0;
  for (const child of Array.from(el.childNodes)) {
    if (count >= MAX_CHILDREN) break;
    const childSnapshot = snapshotNode(child, depth + 1);
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
