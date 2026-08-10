import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Panel } from "./Panel.js";
import type { LensRuntime } from "./runtime.js";

function EmbeddedPanel({ runtime }: { runtime: LensRuntime }) {
  const [recording, setRecording] = useState(true);
  return (
    <Panel
      store={runtime.store}
      causality={runtime.causality}
      recording={recording}
      embedded
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
