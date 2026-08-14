import { isValidElement, useEffect, useRef, useState } from "react";
import type { ComponentId } from "@reactlens/protocol";
import { typeLaneKey, type LaneControls } from "../../laneFilter.js";
import type { TimeCursor } from "../../timeCursor.js";
import type { Timeline as TimelineModel } from "../useTimeline.js";
import { Cascade } from "../../cascade/Cascade.js";
import "../../cascade/transport.css";

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

function playbackDuration(interaction: TimelineModel["interactions"][number]): number {
  const traceSpan = Math.max(1, interaction.end - interaction.start);
  return Math.max(650, Math.min(3_000, traceSpan * 4));
}

type TravelControlProps = {
  "aria-pressed"?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

function travelControlProps(node: React.ReactNode): TravelControlProps | null {
  return isValidElement<TravelControlProps>(node) ? node.props : null;
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
  const [replayMode, setReplayMode] = useState<"interaction" | "session" | null>(null);
  const replayRaf = useRef(0);
  const replayGeneration = useRef(0);
  const transportRef = useRef(transport);
  transportRef.current = transport;
  /** Toggle we invoked because replay needed restoration while the user's mode was off. */
  const autoTravelToggle = useRef<(() => void) | null>(null);

  const ensureReplayTravel = () => {
    const props = travelControlProps(transportRef.current);
    if (!props || props.disabled || props["aria-pressed"] === true || !props.onClick) return;
    autoTravelToggle.current = props.onClick;
    props.onClick();
  };

  const releaseReplayTravel = () => {
    const toggle = autoTravelToggle.current;
    autoTravelToggle.current = null;
    if (!toggle) return;
    // Respect a manual user change during playback. If the user already turned
    // restoration off, do not toggle it back on while cleaning up replay.
    const props = travelControlProps(transportRef.current);
    if (props?.["aria-pressed"] === true) toggle();
  };

  useEffect(
    () => () => {
      replayGeneration.current++;
      cancelAnimationFrame(replayRaf.current);
      releaseReplayTravel();
    },
    [],
  );

  const stopReplay = () => {
    replayGeneration.current++;
    cancelAnimationFrame(replayRaf.current);
    replayRaf.current = 0;
    setReplayMode(null);
    releaseReplayTravel();
  };

  /**
   * Cascade owns its selected interaction internally. During whole-session
   * replay we intentionally select one render from the active interaction so
   * the existing selected-render -> interaction synchronization highlights the
   * corresponding interaction row without introducing a second controlled
   * selection channel into the graph.
   */
  const highlightInteraction = (interaction: TimelineModel["interactions"][number]) => {
    const renderId = interaction.renderIds[0];
    if (renderId === undefined) return;
    const render = model.store.getRender(renderId);
    if (!render) return;
    const name = model.store.instance(render.componentId)?.name;
    if (!name) return;
    model.dispatch({ type: "selectClip", renderId, laneKey: typeLaneKey(name) });
  };

  const playInteraction = (
    interaction: TimelineModel["interactions"][number],
    generation: number,
    done: () => void,
  ) => {
    const traceSpan = Math.max(1, interaction.end - interaction.start);
    const playbackMs = playbackDuration(interaction);
    const startedAt = performance.now();
    onCursor({ mode: "historical", t: interaction.start });

    const tick = (now: number) => {
      if (generation !== replayGeneration.current) return;
      const progress = Math.min(1, (now - startedAt) / playbackMs);
      onCursor({
        mode: "historical",
        t: interaction.start + traceSpan * progress,
      });
      if (progress >= 1) {
        replayRaf.current = 0;
        done();
        return;
      }
      replayRaf.current = requestAnimationFrame(tick);
    };
    replayRaf.current = requestAnimationFrame(tick);
  };

  const replayInteraction = () => {
    const interaction = interactionAtCursor(model, cursor);
    if (!interaction) return;

    stopReplay();
    ensureReplayTravel();
    const generation = ++replayGeneration.current;
    setReplayMode("interaction");
    highlightInteraction(interaction);
    playInteraction(interaction, generation, () => {
      if (generation !== replayGeneration.current) return;
      setReplayMode(null);
      releaseReplayTravel();
    });
  };

  const replaySession = () => {
    if (model.interactions.length === 0) return;

    stopReplay();
    ensureReplayTravel();
    const generation = ++replayGeneration.current;
    setReplayMode("session");

    const playAt = (index: number) => {
      if (generation !== replayGeneration.current) return;
      const interaction = model.interactions[index];
      if (!interaction) {
        model.dispatch({ type: "clearClip" });
        setReplayMode(null);
        releaseReplayTravel();
        return;
      }
      highlightInteraction(interaction);
      playInteraction(interaction, generation, () => playAt(index + 1));
    };

    playAt(0);
  };

  /**
   * Cascade navigation is not a scrub. When its interaction list asks to seek
   * to the start of a *different* interaction, show the completed cascade by
   * placing the shared cursor at that interaction's end. Otherwise every node
   * after the start is painted as future-of-cursor and looks disabled.
   *
   * Exact node seeks inside the current interaction still pass through
   * unchanged, so double-click time travel keeps its progressive/future dim.
   * Replay bypasses this adapter and explicitly animates start -> end above.
   */
  const onCascadeCursor = (next: TimeCursor) => {
    if (next.mode === "historical") {
      const currentInteraction = interactionAtCursor(model, cursor);
      const targetInteraction = interactionAtCursor(model, next);
      const navigatingInteraction =
        targetInteraction !== null &&
        targetInteraction.id !== currentInteraction?.id &&
        Math.abs(next.t - targetInteraction.start) < 0.001;

      if (navigatingInteraction) {
        onCursor({ mode: "historical", t: targetInteraction.end });
        return;
      }
    }
    onCursor(next);
  };

  const interaction = interactionAtCursor(model, cursor);
  const replaying = replayMode !== null;
  const cascadeTransport = (
    <span className="rl-cascade-transport">
      <span className="rl-cascade-transport-group" aria-label="Replay controls">
        <button
          type="button"
          className={`rl-cascade-transport-button${replayMode === "interaction" ? " active" : ""}`}
          disabled={!interaction}
          title={
            replayMode === "interaction"
              ? "Stop replay"
              : interaction
                ? `Replay ${interaction.label}`
                : "No interaction to replay"
          }
          onClick={replaying ? stopReplay : replayInteraction}
        >
          <span className="rl-cascade-transport-icon">{replayMode === "interaction" ? "■" : "↻"}</span>
          <span>{replayMode === "interaction" ? "Stop" : "Replay"}</span>
        </button>
        <button
          type="button"
          className={`rl-cascade-transport-button session${replayMode === "session" ? " active" : ""}`}
          disabled={model.interactions.length === 0}
          title={
            replayMode === "session"
              ? "Stop session replay"
              : `Replay all ${model.interactions.length.toLocaleString()} interactions in order`
          }
          onClick={replaying ? stopReplay : replaySession}
        >
          <span className="rl-cascade-transport-icon">{replayMode === "session" ? "■" : "▶"}</span>
          <span>{replayMode === "session" ? "Stop" : "Replay all"}</span>
        </button>
      </span>
      {transport ? (
        <span
          className="rl-cascade-travel-control"
          title="Restore the inspected page while replaying or seeking"
        >
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
      onCursor={onCascadeCursor}
      {...(onSelectComponent ? { onSelectComponent } : {})}
      {...(onHighlight ? { onHighlight } : {})}
      transport={cascadeTransport}
    />
  );
}
