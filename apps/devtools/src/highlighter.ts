import { needsReveal, pickRevealTarget, revealBehavior } from "./revealGeometry.js";

/**
 * Draws a translucent box over a component's DOM nodes on the inspected page —
 * the page side of bidirectional selection (§73). The panel resolves a
 * component id to DOM nodes and hands them here; `reveal` additionally scrolls
 * the page when the component sits outside the viewport.
 *
 * The boxes are `position: fixed`, so the layer tracks scroll and resize while
 * it is visible — otherwise the highlight drifts off its component the moment
 * anything moves (including our own reveal scroll).
 *
 * Shared by the embedded dock and the extension's page-world bundle
 * (`apps/extension/src/injected/highlighter.ts`), which only differ in styling.
 */
export interface Highlighter {
  show(nodes: Node[]): void;
  /** Show, then scroll the page to the component if it isn't already in view. */
  reveal(nodes: Node[]): void;
  hide(): void;
  dispose(): void;
}

/** Quiet enough to read the UI underneath: the highlight points at a
 * component, it shouldn't repaint it. Themed via --rl-highlight-*, with the
 * values inlined as fallbacks for pages the panel CSS never reaches. */
const DEFAULT_BOX: Partial<CSSStyleDeclaration> = {
  background: "var(--rl-highlight-fill, rgba(167,139,250,0.05))",
  outline: "1px solid var(--rl-highlight-edge, rgba(167,139,250,0.32))",
  borderRadius: "2px",
};

export function createHighlighter(
  opts: { boxStyle?: Partial<CSSStyleDeclaration> } = {},
): Highlighter {
  const boxStyle = opts.boxStyle ?? DEFAULT_BOX;
  let layer: HTMLDivElement | null = null;
  /** The elements currently outlined — kept so scroll can re-place the boxes. */
  let shown: Element[] = [];
  let tracking = false;
  let frame = 0;

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

  /** Place one box per painted element. Returns false when nothing painted. */
  function paint(): boolean {
    const rects = shown
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0);
    if (rects.length === 0) {
      hide();
      return false;
    }
    const el = ensureLayer();
    el.innerHTML = "";
    for (const r of rects) el.appendChild(box(r));
    el.style.display = "block";
    return true;
  }

  function show(nodes: Node[]): void {
    shown = nodes.filter((n): n is Element => n.nodeType === Node.ELEMENT_NODE);
    if (paint()) track();
  }

  function reveal(nodes: Node[]): void {
    show(nodes);
    const target = pickRevealTarget(nodes);
    if (!target) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (!needsReveal(target.getBoundingClientRect(), viewport)) return;
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: revealBehavior() });
  }

  function box(r: DOMRect): HTMLDivElement {
    const b = document.createElement("div");
    Object.assign(
      b.style,
      {
        position: "absolute",
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      } satisfies Partial<CSSStyleDeclaration>,
      boxStyle,
    );
    return b;
  }

  /** One repaint per frame, however many scroll events arrive. */
  function onGeometryChange(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (shown.length > 0) paint();
    });
  }

  function track(): void {
    if (tracking) return;
    tracking = true;
    // Capture phase: scroll doesn't bubble, so this is what catches nested
    // scroll containers rather than only the document.
    window.addEventListener("scroll", onGeometryChange, { capture: true, passive: true });
    window.addEventListener("resize", onGeometryChange, { passive: true });
  }

  function untrack(): void {
    if (!tracking) return;
    tracking = false;
    window.removeEventListener("scroll", onGeometryChange, true);
    window.removeEventListener("resize", onGeometryChange);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function hide(): void {
    shown = [];
    untrack();
    if (layer) layer.style.display = "none";
  }

  function dispose(): void {
    untrack();
    shown = [];
    layer?.remove();
    layer = null;
  }

  return { show, reveal, hide, dispose };
}
