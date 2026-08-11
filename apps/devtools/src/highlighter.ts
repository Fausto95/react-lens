/**
 * Draws a translucent box over a component's DOM nodes on the inspected page —
 * the page side of bidirectional selection (§73). Embedded-mode only; in the
 * extension this would post a message to the content script instead.
 */
export interface Highlighter {
  show(nodes: Node[]): void;
  hide(): void;
  dispose(): void;
}

export function createHighlighter(): Highlighter {
  let layer: HTMLDivElement | null = null;

  function ensureLayer(): HTMLDivElement {
    if (layer) return layer;
    const el = document.createElement("div");
    el.id = "react-lens-highlight";
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483640",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    layer = el;
    return el;
  }

  function show(nodes: Node[]): void {
    const rects = nodes
      .filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0);
    if (rects.length === 0) {
      hide();
      return;
    }
    const el = ensureLayer();
    el.innerHTML = "";
    for (const r of rects) el.appendChild(box(r));
    el.style.display = "block";
  }

  function box(r: DOMRect): HTMLDivElement {
    const b = document.createElement("div");
    Object.assign(b.style, {
      position: "absolute",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      // Quiet enough to read the UI underneath: the highlight points at a
      // component, it shouldn't repaint it. Themed via --rl-highlight-*, with
      // the values inlined as fallbacks for pages the panel CSS never reaches.
      background: "var(--rl-highlight-fill, rgba(167,139,250,0.05))",
      outline: "1px solid var(--rl-highlight-edge, rgba(167,139,250,0.32))",
      borderRadius: "2px",
    } satisfies Partial<CSSStyleDeclaration>);
    return b;
  }

  function hide(): void {
    if (layer) layer.style.display = "none";
  }

  function dispose(): void {
    layer?.remove();
    layer = null;
  }

  return { show, hide, dispose };
}
