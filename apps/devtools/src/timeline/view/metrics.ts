/**
 * Shared pixel constants for the lane canvas.
 *
 * These live apart from the components so the name gutter, the ruler spacer
 * and the arrow layer all measure from the same numbers — the concept's 148px
 * gutter is referenced in three places and drifting them apart misaligns the
 * whole grid.
 */

/** Width of the sticky lane-name gutter (concept: `.lname` / `.rspacer`). */
export const NAME_W = 148;

/**
 * Legibility floor for a clip, in px.
 *
 * A sub-millisecond render is a fraction of a pixel on a multi-second axis.
 * Applied in ONE place (the clip's layout) so hit-testing, labels and arrow
 * endpoints all agree about where the box actually is.
 */
export const MIN_CLIP_PX = 4;

/** Below this width a clip is a tick mark: no label, still clickable. */
export const CLIP_LABEL_MIN_PX = 44;
