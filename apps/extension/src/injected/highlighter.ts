/**
 * Draws a translucent box over a component's DOM nodes in the inspected page.
 * The page side of bidirectional selection (§73): the panel posts a component
 * id, injected.ts resolves it to DOM nodes, and this paints the overlay.
 */
export interface Highlighter {
  show(nodes: Node[]): void;
  hide(): void;
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
      background: "rgba(167,139,250,0.28)",
      outline: "2px solid rgba(167,139,250,0.95)",
      borderRadius: "2px",
      boxShadow: "0 0 0 1px rgba(167,139,250,0.35)",
    } satisfies Partial<CSSStyleDeclaration>);
    return b;
  }

  function hide(): void {
    if (layer) layer.style.display = "none";
  }

  return { show, hide };
}
