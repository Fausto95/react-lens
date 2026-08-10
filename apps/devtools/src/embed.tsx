import { StrictMode, useState, useMemo, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentId } from "@react-lens/protocol";
import { Panel } from "./Panel.js";
import type { LensRuntime } from "./runtime.js";
import { createHighlighter } from "./highlighter.js";

function EmbeddedPanel({ runtime }: { runtime: LensRuntime }) {
  const [recording, setRecording] = useState(true);
  const highlighter = useMemo(() => createHighlighter(), []);
  useEffect(() => () => highlighter.dispose(), [highlighter]);

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
