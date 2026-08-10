import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TraceStore } from "@react-lens/trace-engine";
import { createCausality } from "@react-lens/causality";
import { Panel } from "@react-lens/devtools/panel";
import { PANEL_PORT_PREFIX, type PortMessage } from "../transport.js";

/**
 * The DevTools panel. Owns the authoritative trace store on the panel side and
 * feeds it frames arriving over the background port for the inspected tab.
 */
function ExtensionPanel() {
  const store = useMemo(() => new TraceStore(), []);
  const causality = useMemo(() => createCausality(store), [store]);
  const [recording, setRecording] = useState(true);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    const port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
    portRef.current = port;

    port.onMessage.addListener((msg: PortMessage) => {
      // Both live tree frames and on-demand snapshot responses ingest the same
      // way — snapshot frames just carry a single snapshot and no events.
      if (msg.kind === "frame" || msg.kind === "snapshot") store.ingest(msg.frame);
    });
    return () => port.disconnect();
  }, [store]);

  return (
    <Panel
      store={store}
      causality={causality}
      recording={recording}
      onToggleRecording={() => {
        const next = !recording;
        setRecording(next);
        portRef.current?.postMessage({ kind: "record", recording: next } satisfies PortMessage);
      }}
      onRequestSnapshot={(renderId) =>
        portRef.current?.postMessage({ kind: "snapshot-request", renderId } satisfies PortMessage)
      }
    />
  );
}

createRoot(document.getElementById("root")!).render(<ExtensionPanel />);
