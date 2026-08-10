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
    let disposed = false;
    const tabId = chrome.devtools.inspectedWindow.tabId;

    // The background service worker is recycled at will, which disconnects this
    // port. Reconnect when that happens: the background re-sends `panel-ready`,
    // the content buffer replays, and the store dedupes by renderId — so the
    // trace survives worker restarts without gaps or double-counting.
    const connect = () => {
      if (disposed) return;
      const port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
      portRef.current = port;
      port.onMessage.addListener((msg: PortMessage) => {
        // Live tree frames and on-demand snapshot responses ingest the same way.
        if (msg.kind === "frame" || msg.kind === "snapshot") store.ingest(msg.frame);
      });
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        if (!disposed) setTimeout(connect, 500);
      });
    };
    connect();

    // The inspected page navigated/reloaded: the page re-mints component and
    // render ids from scratch, so the old trace is not just stale — its ids
    // would collide with the fresh ones (and the renderId dedup would drop the
    // new renders). Clear the store so the fresh page starts clean.
    const onNavigated = () => store.clear();
    chrome.devtools.network.onNavigated.addListener(onNavigated);

    return () => {
      disposed = true;
      chrome.devtools.network.onNavigated.removeListener(onNavigated);
      portRef.current?.disconnect();
    };
  }, [store]);

  // Guard every send: the port may be mid-reconnect after a worker recycle.
  const send = (msg: PortMessage) => {
    const port = portRef.current;
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch {
      portRef.current = null;
    }
  };

  return (
    <Panel
      store={store}
      causality={causality}
      recording={recording}
      onToggleRecording={() => {
        const next = !recording;
        setRecording(next);
        send({ kind: "record", recording: next });
      }}
      onRequestSnapshot={(renderId) => send({ kind: "snapshot-request", renderId })}
      onHighlight={(componentId) => send({ kind: "highlight", componentId })}
      onReplayCommit={(componentIds) => send({ kind: "replay", componentIds })}
    />
  );
}

createRoot(document.getElementById("root")!).render(<ExtensionPanel />);
