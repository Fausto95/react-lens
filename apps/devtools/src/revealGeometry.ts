/**
 * Geometry for "scroll the page to this component" — the page side of
 * bidirectional selection (§73). Pure and dependency-free so both highlighters
 * (embedded dock and the extension's page-world bundle) share one decision.
 */

/** Comfort band at the top and bottom of the viewport, in CSS pixels. */
export const REVEAL_MARGIN = 24;

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Should the page scroll to bring this box into view? Selecting a component
 * that is already on screen must never move the page — tree ↑/↓ navigation
 * selects on every keystroke, and scrolling on each one would be unusable.
 *
 * Only the vertical axis is considered: horizontal scroll containers are rare
 * and nudging them sideways is more disorienting than helpful.
 */
export function needsReveal(rect: DOMRect, viewport: Viewport): boolean {
  const fits = rect.height <= viewport.height - REVEAL_MARGIN * 2;
  if (!fits) {
    // A section taller than the viewport can never sit inside the margins.
    // Its top edge being in view is as revealed as it gets.
    return rect.top < 0 || rect.top > viewport.height - REVEAL_MARGIN;
  }
  return rect.top < REVEAL_MARGIN || rect.bottom > viewport.height - REVEAL_MARGIN;
}

/** The node to scroll to: the component's first host element that paints. */
export function pickRevealTarget(nodes: ReadonlyArray<Node>): Element | null {
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return el;
  }
  return null;
}

/** Animate the scroll unless the user asked us not to. */
export function revealBehavior(): ScrollBehavior {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  } catch {
    return "smooth";
  }
}
