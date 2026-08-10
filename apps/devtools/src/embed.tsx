import { StrictMode, useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentId } from "@react-lens/protocol";
import { Panel } from "./Panel.js";
import type { LensRuntime } from "./runtime.js";
import { createHighlighter } from "./highlighter.js";
import { createRenderOverlay } from "./renderOverlay.js";
import { createInspectController } from "./inspectController.js";

const WAVE_MAX_GROUPS = 300;
const WAVE_MAX_NODES = 400;
const WAVE_MAX_MS = 1600;

function EmbeddedPanel({
  runtime,
  host,
}: {
  runtime: LensRuntime;
  host: HTMLElement;
}) {
  const [recording, setRecording] = useState(true);
  const [overlayOn, setOverlayOn] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [pickedId, setPickedId] = useState<ComponentId | null>(null);
  const highlighter = useMemo(() => createHighlighter(), []);
  const overlay = useMemo(() => createRenderOverlay(runtime), [runtime]);
  const waveTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const inspect = useMemo(
    () =>
      createInspectController({
        runtime,
        highlighter,
        // Sticky pick: keep inspect active so double-click text edit still works.
        onPick: (pick) => setPickedId(pick.componentId),
        ignoreRoot: () => host,
      }),
    [runtime, highlighter, host],
  );

  useEffect(() => () => highlighter.dispose(), [highlighter]);
  useEffect(() => () => overlay.dispose(), [overlay]);
  useEffect(() => () => inspect.dispose(), [inspect]);

  const cancelWave = () => {
    for (const t of waveTimers.current) clearTimeout(t);
    waveTimers.current = [];
    highlighter.hide();
  };
  const replayWave = (ids: ComponentId[]) => {
    cancelWave();
    const capped = ids.slice(0, WAVE_MAX_GROUPS);
    const groups = capped
      .map((id) => runtime.domNodesOf(id))
      .filter((nodes) => nodes.length > 0);
    if (groups.length === 0) return;
    const step = Math.min(140, WAVE_MAX_MS / Math.max(1, groups.length));
    const acc: Node[] = [];
    acc.push(...groups[0]!);
    highlighter.show(acc);
    groups.forEach((nodes, i) => {
      if (i === 0) return;
      waveTimers.current.push(
        setTimeout(() => {
          acc.push(...nodes);
          if (acc.length > WAVE_MAX_NODES) acc.splice(0, acc.length - WAVE_MAX_NODES);
          highlighter.show(acc);
        }, i * step),
      );
    });
    waveTimers.current.push(setTimeout(cancelWave, groups.length * step + 800));
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

  const onToggleInspect = useCallback(() => {
    setInspecting((on) => {
      const next = !on;
      if (next) inspect.start();
      else inspect.stop();
      return next;
    });
  }, [inspect]);

  return (
    <Panel
      store={runtime.store}
      causality={runtime.causality}
      recording={recording}
      embedded
      overlayEnabled={overlayOn}
      inspecting={inspecting}
      onToggleInspect={onToggleInspect}
      selectComponent={pickedId}
      onSelectConsumed={() => setPickedId(null)}
      onToggleOverlay={() => {
        if (overlayOn) overlay.disable();
        else overlay.enable();
        setOverlayOn((v) => !v);
      }}
      onReplayCommit={replayWave}
      timeTravel={runtime.timeTravel}
      {...(edit ? { edit } : {})}
      onHighlight={(id: ComponentId | null) => {
        if (id === null) {
          if (waveTimers.current.length > 0) return;
          highlighter.hide();
          return;
        }
        highlighter.show(runtime.domNodesOf(id));
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
  runtime.ignoreContainer(host);
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <EmbeddedPanel runtime={runtime} host={host} />
    </StrictMode>,
  );
  return () => {
    root.unmount();
    host.remove();
  };
}
