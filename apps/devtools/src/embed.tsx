import { StrictMode, useState, useMemo, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentId } from "@react-lens/protocol";
import { Panel } from "./Panel.js";
import type { LensRuntime } from "./runtime.js";
import { createHighlighter } from "./highlighter.js";
import { createRenderOverlay } from "./renderOverlay.js";

// Update Wave bounds — a huge commit must not wash the page purple or run for
// minutes, and back-to-back replays cancel the wave still in flight.
const WAVE_MAX_GROUPS = 300;
const WAVE_MAX_NODES = 400;
const WAVE_MAX_MS = 1600;

function EmbeddedPanel({ runtime }: { runtime: LensRuntime }) {
  const [recording, setRecording] = useState(true);
  const [overlayOn, setOverlayOn] = useState(false);
  const highlighter = useMemo(() => createHighlighter(), []);
  const overlay = useMemo(() => createRenderOverlay(runtime), [runtime]);
  const waveTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => highlighter.dispose(), [highlighter]);
  useEffect(() => () => overlay.dispose(), [overlay]);

  const cancelWave = () => {
    for (const t of waveTimers.current) clearTimeout(t);
    waveTimers.current = [];
    highlighter.hide();
  };
  const replayWave = (ids: ComponentId[]) => {
    cancelWave();
    const capped = ids.slice(0, WAVE_MAX_GROUPS);
    const groups = capped.map((id) => runtime.domNodesOf(id));
    const step = Math.min(110, WAVE_MAX_MS / Math.max(1, capped.length));
    const acc: Node[] = [];
    capped.forEach((_, i) => {
      waveTimers.current.push(
        setTimeout(() => {
          const nodes = groups[i];
          if (nodes) acc.push(...nodes);
          if (acc.length > WAVE_MAX_NODES) acc.splice(0, acc.length - WAVE_MAX_NODES);
          highlighter.show(acc);
        }, i * step),
      );
    });
    waveTimers.current.push(setTimeout(cancelWave, capped.length * step + 500));
  };
  useEffect(() => () => cancelWave(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = useMemo(
    () =>
      runtime.canEditValues()
        ? {
            setProp: (id: ComponentId, path: Array<string | number>, value: unknown) =>
              runtime.setProp(id, path, value),
            setHookState: (
              id: ComponentId,
              hookIndex: number,
              path: Array<string | number>,
              value: unknown,
            ) => runtime.setHookState(id, hookIndex, path, value),
          }
        : undefined,
    [runtime],
  );

  return (
    <Panel
      store={runtime.store}
      causality={runtime.causality}
      recording={recording}
      embedded
      overlayEnabled={overlayOn}
      onToggleOverlay={() => {
        if (overlayOn) overlay.disable();
        else overlay.enable();
        setOverlayOn((v) => !v);
      }}
      onReplayCommit={replayWave}
      {...(edit ? { edit } : {})}
      onHighlight={(id: ComponentId | null) => {
        if (id === null) highlighter.hide();
        else highlighter.show(runtime.domNodesOf(id));
      }}
      onToggleRecording={() => {
        if (recording) runtime.stop();
        else runtime.start();
        setRecording((r) => !r);
      }}
    />
  );
}

/**
 * Mount the panel as an in-page overlay. Used by the playground in dev mode so
 * the whole pipeline (instrumentation → trace store → causality → UI) is
 * exercised without the extension. The panel deliberately mounts on a detached
 * React root so it never appears in the inspected app's own fiber tree.
 */
export function mountEmbedded(runtime: LensRuntime): () => void {
  const host = document.createElement("div");
  host.id = "react-lens-overlay";
  document.body.appendChild(host);
  // Keep the panel's own React tree out of the capture (prevents a feedback
  // loop where rendering the panel produces events that re-render the panel).
  runtime.ignoreContainer(host);
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <EmbeddedPanel runtime={runtime} />
    </StrictMode>,
  );
  return () => {
    root.unmount();
    host.remove();
  };
}
