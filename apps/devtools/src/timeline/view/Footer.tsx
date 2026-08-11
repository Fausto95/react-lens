import { SCALE_MAX, SCALE_MIN } from "../model/scale.js";
import type { RegionStats } from "../model/lanes.js";

/**
 * Zoom slider on a FIXED logarithmic scale (0 = fully out, 1000 = fully in).
 *
 * Binding the slider's range to the session length let the scale move under
 * the thumb: while recording, the session grows every commit, so the thumb
 * drifted on its own and could travel opposite to the button just pressed.
 */
export const ZOOM_STEPS = 1000;
const ZOOM_RANGE = Math.log(SCALE_MAX / SCALE_MIN);

export function zoomToSlider(pxPerMs: number): number {
  const clamped = Math.min(Math.max(pxPerMs, SCALE_MIN), SCALE_MAX);
  return Math.round((Math.log(clamped / SCALE_MIN) / ZOOM_RANGE) * ZOOM_STEPS);
}

export function sliderToZoom(value: number): number {
  const frac = Math.min(Math.max(value, 0), ZOOM_STEPS) / ZOOM_STEPS;
  return SCALE_MIN * Math.exp(frac * ZOOM_RANGE);
}

export function Footer({
  playing,
  stats,
  pxPerMs,
  fitPxPerMs,
  isFit,
  extra,
  onPlayToggle,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onFit,
}: {
  playing: boolean;
  stats: RegionStats;
  pxPerMs: number;
  /** The scale "fit" resolves to — the 100% reference for the readout. */
  fitPxPerMs: number;
  isFit: boolean;
  /** Transport controls contributed by the panel (travel toggle, A/B…). */
  extra?: React.ReactNode;
  onPlayToggle: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo: (pxPerMs: number) => void;
  onFit: () => void;
}) {
  return (
    <div className="tlfoot">
      <button
        type="button"
        className={`btn${playing ? " active" : ""}`}
        title={playing ? "Pause (space)" : "Play from playhead (space)"}
        aria-label={playing ? "Pause" : "Play from playhead"}
        aria-pressed={playing}
        onClick={onPlayToggle}
      >
        {playing ? "⏸" : "▶"}
      </button>

      <span>
        In selection: <b>{stats.renders} renders</b>
      </span>
      {stats.wasted > 0 && (
        <span className="mono" style={{ color: "var(--warn)" }}>
          {stats.wasted} wasted
        </span>
      )}
      <span className="mono">total {stats.selfMs.toFixed(0)} ms</span>

      {extra}

      <div className="zoom">
        <button
          type="button"
          className="btn"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={onZoomOut}
        >
          −
        </button>
        <input
          type="range"
          min={0}
          max={ZOOM_STEPS}
          step={1}
          value={zoomToSlider(pxPerMs)}
          aria-label="Zoom level"
          onChange={(e) => onZoomTo(sliderToZoom(Number(e.target.value)))}
        />
        <button
          type="button"
          className="btn"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={onZoomIn}
        >
          +
        </button>
        <button
          type="button"
          className="btn rl-tl-zoom-level"
          title={isFit ? "Fit to width" : "Zoom level — click to fit"}
          aria-label="Fit session to width"
          onClick={onFit}
        >
          {isFit ? "fit" : `${Math.round((pxPerMs / Math.max(fitPxPerMs, 1e-9)) * 100)}%`}
        </button>
      </div>
    </div>
  );
}
