import { IconPause, IconPlay, IconSkipBack, IconSkipForward } from "@reactlens/icons";
import type { RegionStats } from "../model/lanes.js";

/**
 * Zoom controls, expressed as a multiple of **fit** rather than raw px/ms.
 *
 * The underlying scale spans 0.01–5000 px/ms. A slider mapped onto that range
 * put every useful zoom inside a sliver at one end: a full drag barely moved
 * the view and the thumb's position told you nothing. Anchoring on fit gives
 * the control a meaning — `1×` is "the whole session", `MAX_ZOOM×` is as far
 * in as it goes — and the mapping is logarithmic so equal drags double or
 * halve what you see.
 */
export const ZOOM_STEPS = 1000;
/** How far past "fit" the controls zoom in. */
export const MAX_ZOOM = 256;
const LOG_MAX = Math.log(MAX_ZOOM);
/** One button press. */
const STEP = 1.6;

function clampRatio(ratio: number): number {
  return Math.min(Math.max(ratio, 1), MAX_ZOOM);
}

/** px/ms → slider position. */
export function zoomToSlider(pxPerMs: number, fitPxPerMs: number): number {
  const ratio = clampRatio(pxPerMs / Math.max(fitPxPerMs, 1e-9));
  return Math.round((Math.log(ratio) / LOG_MAX) * ZOOM_STEPS);
}

/** Slider position → absolute px/ms. */
export function sliderToZoom(value: number, fitPxPerMs: number): number {
  const frac = Math.min(Math.max(value, 0), ZOOM_STEPS) / ZOOM_STEPS;
  return Math.max(fitPxPerMs, 1e-9) * Math.exp(frac * LOG_MAX);
}

/** Readout: "fit" when the whole session is on screen, else a multiple of it. */
export function zoomLabel(pxPerMs: number, fitPxPerMs: number, isFit: boolean): string {
  if (isFit) return "fit";
  const ratio = pxPerMs / Math.max(fitPxPerMs, 1e-9);
  if (ratio < 1.05) return "fit";
  return ratio >= 10 ? `${Math.round(ratio)}×` : `${ratio.toFixed(1)}×`;
}

export function Footer({
  playing,
  stats,
  pxPerMs,
  fitPxPerMs,
  isFit,
  extra,
  onPlayToggle,
  onStep,
  onZoomTo,
  onFit,
}: {
  playing: boolean;
  stats: RegionStats;
  pxPerMs: number;
  /** The scale "fit" resolves to — the 1× reference for every control here. */
  fitPxPerMs: number;
  isFit: boolean;
  /** Panel-owned transport controls (travel toggle, A/B…), after a separator. */
  extra?: React.ReactNode;
  onPlayToggle: () => void;
  /** Jump the playhead to the adjacent commit — where state actually changes. */
  onStep: (dir: 1 | -1) => void;
  /** Absolute target scale, so every control is the same one-way action. */
  onZoomTo: (pxPerMs: number) => void;
  onFit: () => void;
}) {
  const atMax = pxPerMs >= fitPxPerMs * MAX_ZOOM * 0.999;
  const atMin = pxPerMs <= fitPxPerMs * 1.001;

  return (
    <div className="tlfoot">
      {/* v1's transport: bare icon buttons, with the panel's own controls
          (time travel, A/B) following a separator. */}
      <div className="rl-tl-nav">
        <button
          type="button"
          className="rl-icon-btn"
          title="Previous commit (←)"
          aria-label="Step back one commit"
          onClick={() => onStep(-1)}
        >
          <IconSkipBack size={13} />
        </button>
        <button
          type="button"
          className={`rl-icon-btn${playing ? " active" : ""}`}
          title={playing ? "Pause (space)" : "Play from playhead (space)"}
          aria-label={playing ? "Pause" : "Play from playhead"}
          aria-pressed={playing}
          onClick={onPlayToggle}
        >
          {playing ? <IconPause size={12} /> : <IconPlay size={12} />}
        </button>
        <button
          type="button"
          className="rl-icon-btn"
          title="Next commit (→)"
          aria-label="Step forward one commit"
          onClick={() => onStep(1)}
        >
          <IconSkipForward size={13} />
        </button>
        {extra && (
          <>
            <span className="rl-zoom-sep" />
            {extra}
          </>
        )}
      </div>

      <span>
        In selection: <b>{stats.renders} renders</b>
      </span>
      {stats.wasted > 0 && (
        <span className="mono" style={{ color: "var(--warn)" }}>
          {stats.wasted} wasted
        </span>
      )}
      <span className="mono">total {stats.selfMs.toFixed(0)} ms</span>

      <div className="zoom">
        <button
          type="button"
          className="btn"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={atMin}
          onClick={() => onZoomTo(Math.max(fitPxPerMs, pxPerMs / STEP))}
        >
          −
        </button>
        <input
          type="range"
          min={0}
          max={ZOOM_STEPS}
          step={1}
          value={zoomToSlider(pxPerMs, fitPxPerMs)}
          aria-label="Zoom level"
          title="Zoom"
          onChange={(e) => onZoomTo(sliderToZoom(Number(e.target.value), fitPxPerMs))}
        />
        <button
          type="button"
          className="btn"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={atMax}
          onClick={() => onZoomTo(Math.min(fitPxPerMs * MAX_ZOOM, pxPerMs * STEP))}
        >
          +
        </button>
        <button
          type="button"
          className="btn rl-tl-zoom-level"
          title={isFit ? "Showing the whole session" : "Fit the whole session"}
          aria-label="Fit session to width"
          onClick={onFit}
        >
          {zoomLabel(pxPerMs, fitPxPerMs, isFit)}
        </button>
      </div>
    </div>
  );
}
