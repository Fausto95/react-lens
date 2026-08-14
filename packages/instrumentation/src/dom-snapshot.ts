import type { DOMSnapshot, DOMNodeSnapshot, DOMVisualSnapshot } from "@reactlens/protocol";

const MAX_DEPTH = 6;
const MAX_CHILDREN = 32;
const MAX_TEXT = 120;

/**
 * High-signal browser-resolved properties. This intentionally observes the
 * browser output rather than Tailwind/CSS Modules/CSS-in-JS implementation
 * details, so visual history works regardless of styling technique.
 */
const VISUAL_STYLE_PROPERTIES = [
  "display", "visibility", "opacity", "position", "z-index",
  "overflow", "overflow-x", "overflow-y", "box-sizing",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-radius", "background-color", "background-image", "color",
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
  "text-align", "white-space", "flex-direction", "flex-wrap", "flex-grow",
  "flex-shrink", "flex-basis", "align-items", "align-content", "align-self",
  "justify-content", "gap", "row-gap", "column-gap", "grid-template-columns",
  "grid-template-rows", "grid-column", "grid-row", "transform", "transform-origin",
  "filter", "box-shadow", "clip-path", "object-fit", "object-position",
] as const;

export interface SnapshotDomOptions {
  /** Default 6 — the per-render budget. Commit-wide captures pass more. */
  maxDepth?: number;
  maxChildren?: number;
  /** Capture browser-resolved style + layout. Defaults on for budgeted commit captures. */
  captureVisuals?: boolean;
}

/** Serializes a DOM subtree into the structured snapshot the diff engine reads. */
export function snapshotDom(node: Node, options?: SnapshotDomOptions): DOMSnapshot | undefined {
  const limits = {
    maxDepth: options?.maxDepth ?? MAX_DEPTH,
    maxChildren: options?.maxChildren ?? MAX_CHILDREN,
    // Instrumentation passes an explicit budget only for its throttled whole-page
    // commit capture. Per-render snapshotDom(first) stays structural and cheap.
    captureVisuals: options?.captureVisuals ?? options !== undefined,
  };
  const root = snapshotNode(node, 0, limits);
  if (!root) return undefined;
  return { root };
}

function snapshotNode(
  node: Node,
  depth: number,
  limits: { maxDepth: number; maxChildren: number; captureVisuals: boolean },
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
  if (limits.captureVisuals) snapshot.visual = visualOf(el);

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

function visualOf(el: Element): DOMVisualSnapshot {
  const visual: DOMVisualSnapshot = {};
  const view = el.ownerDocument?.defaultView;

  if (view) {
    const style = view.getComputedStyle(el);
    const computedStyle: Record<string, string> = {};
    for (const property of VISUAL_STYLE_PROPERTIES) {
      const value = style.getPropertyValue(property);
      if (value) computedStyle[property] = value;
    }
    if (Object.keys(computedStyle).length) visual.computedStyle = computedStyle;

    const customProperties: Record<string, string> = {};
    for (let i = 0; i < style.length; i++) {
      const property = style.item(i);
      if (!property.startsWith("--")) continue;
      const value = style.getPropertyValue(property).trim();
      if (value) customProperties[property] = value;
    }
    if (Object.keys(customProperties).length) visual.customProperties = customProperties;
  }

  const rect = el.getBoundingClientRect();
  visual.rect = {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
  return visual;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
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
