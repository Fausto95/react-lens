import {
  createHighlighter as createLayer,
  type Highlighter,
} from "@reactlens/devtools/highlighter";

export type { Highlighter };

/**
 * Draws a translucent box over a component's DOM nodes in the inspected page.
 * The page side of bidirectional selection (§73): the panel posts a component
 * id, injected.ts resolves it to DOM nodes, and this paints the overlay — and
 * scrolls the page to it when the message asks for a reveal.
 *
 * Same layer as the embedded dock; the extension only paints it bolder, because
 * the panel's CSS variables never reach the inspected page.
 */
export function createHighlighter(): Highlighter {
  return createLayer({
    boxStyle: {
      background: "rgba(167,139,250,0.28)",
      outline: "2px solid rgba(167,139,250,0.95)",
      borderRadius: "2px",
      boxShadow: "0 0 0 1px rgba(167,139,250,0.35)",
    },
  });
}
