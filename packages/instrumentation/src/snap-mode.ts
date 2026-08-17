/** The id is stable so a stale tag from a previous session can be adopted. */
export const SNAP_MODE_STYLE_ID = "react-lens-snap-mode";

/**
 * Transitions and animations are the difference between "the style did not
 * rewind" and "the style arrives 400ms after the playhead". A rewind is not a
 * user interaction — there is nothing to ease from — so while travel drives the
 * page, motion is switched off and every restore lands on the frame it belongs
 * to.
 *
 * `transition: none` alone is not enough: a keyframe animation would keep
 * running against rewound state, and smooth scrolling turns a jump into a slide.
 */
const SNAP_CSS = `*, *::before, *::after {
  transition: none !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  scroll-behavior: auto !important;
}`;

export interface SnapMode {
  /** Install the suppression stylesheet. Idempotent — called per apply. */
  on(): void;
  /** Remove it, restoring the page's own motion. */
  off(): void;
  isOn(): boolean;
}

/**
 * Owns the page's motion suppression while time travel is active. Inert without
 * a document, so the runtime stays usable in tests and non-DOM hosts.
 */
export function createSnapMode(doc: Document | undefined): SnapMode {
  let installed: HTMLStyleElement | null = null;

  return {
    on(): void {
      if (!doc) return;
      if (installed?.isConnected) return;
      // A reload with the panel open can leave a tag behind; adopt it rather
      // than stacking a second one.
      const existing = doc.getElementById(SNAP_MODE_STYLE_ID);
      if (existing instanceof HTMLStyleElement) {
        existing.textContent = SNAP_CSS;
        installed = existing;
        return;
      }
      const style = doc.createElement("style");
      style.id = SNAP_MODE_STYLE_ID;
      style.textContent = SNAP_CSS;
      (doc.head ?? doc.documentElement)?.appendChild(style);
      installed = style;
    },
    off(): void {
      installed?.remove();
      installed = null;
      // Belt and braces: a tag from an earlier runtime would otherwise freeze
      // the page's motion for good.
      if (doc) doc.getElementById(SNAP_MODE_STYLE_ID)?.remove();
    },
    isOn(): boolean {
      return installed?.isConnected === true;
    },
  };
}
