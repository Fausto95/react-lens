import { useEffect, useRef, useState } from "react";
import type { ComponentId } from "@reactlens/protocol";
import type { LaneControls } from "../../laneFilter.js";
import type { TimeCursor } from "../../timeCursor.js";
import type { Timeline as TimelineModel } from "../useTimeline.js";
import { Cascade } from "../../cascade/Cascade.js";

function interactionAtCursor(model: TimelineModel, cursor: TimeCursor) {
  const interactions = model.interactions;
  if (interactions.length === 0) return null;
  const t = cursor.mode === "live" ? interactions.at(-1)!.start : cursor.t;
  let lo = 0;
  let hi = interactions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (interactions[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  return interactions[Math.max(0, lo - 1)] ?? interactions[0]!;
}

/**
 * @deprecated Compatibility adapter for callers that still mount the old
 * Timeline view entry point. Cascade is now the product/view abstraction.
 *
 * Replay intentionally lives at this temporal boundary rather than inside the
 * graph renderer: Cascade explains causality, while the shared TimeCursor and
 * panel time-travel controller own playback/restoration.
 */
export function Timeline({
  model,
  cursor,
  onCursor,
  lanes: _lanes,
  fixApplied: _fixApplied,
  onSelectComponent,
  onHighlight,
  transport,
}: {
  model: TimelineModel;
  cursor: TimeCursor;
  onCursor: (cursor: TimeCursor) => void;
  lanes?: LaneControls;
  fixApplied?: boolean;
  onSelectComponent?: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  transport?: React.ReactNode;
}) {
  const [replaying, setReplaying] = useState(false);
  const replayRaf = useRef(0);

  useEffect(
    () => () => {
      cancelAnimationFrame(replayRaf.current);
    },
    [],
  );

  const stopReplay = () => {
    cancelAnimationFrame(replayRaf.current);
    replayRaf.current = 0;
    setReplaying(false);
  };

  const replayInteraction = () => {
    const interaction = interactionAtCursor(model, cursor);
    if (!interaction) return;

    stopReplay();
    setReplaying(true);
    const traceSpan = Math.max(1, interaction.end - interaction.start);
    // Keep short browser interactions readable while preserving relative time.
    const playbackMs = Math.max(700, Math.min(4_000, traceSpan * 4));
    const startedAt = performance.now();
    onCursor({ mode: "historical", t: interaction.start });

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / playbackMs);
      onCursor({
        mode: "historical",
        t: interaction.start + traceSpan * progress,
      });
      if (progress >= 1) {
        replayRaf.current = 0;
        setReplaying(false);
        return;
      }
      replayRaf.current = requestAnimationFrame(tick);
    };
    replayRaf.current = requestAnimationFrame(tick);
  };

  const interaction = interactionAtCursor(model, cursor);
  const cascadeTransport = (
    <span className="rl-cascade-transport">
      <button
        type="button"
        className={`rl-icon-btn rl-cascade-replay${replaying ? " active" : ""}`}
        disabled={!interaction}
        title={
          replaying
            ? "Stop replay"
            : interaction
              ? `Replay ${interaction.label}`
              : "No interaction to replay"
        }
        onClick={replaying ? stopReplay : replayInteraction}
      >
        {replaying ? "■ Stop" : "↻ Replay"}
      </button>
      {transport ? (
        <span className="rl-cascade-travel-control" title="Restore the inspected page while replaying or seeking">
          <span className="rl-cascade-travel-label">Time travel</span>
          {transport}
        </span>
      ) : null}
    </span>
  );

  return (
    <Cascade
      store={model.store}
      model={model}
      cursor={cursor}
      onCursor={onCursor}
      {...(onSelectComponent ? { onSelectComponent } : {})}
      {...(onHighlight ? { onHighlight } : {})}
      transport={cascadeTransport}
    />
  );
}
