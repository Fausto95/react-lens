import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TraceStore } from "@react-lens/trace-engine";
import { createCausality } from "@react-lens/causality";
import { Panel, configureSourceFetcher } from "@react-lens/devtools/panel";
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
  const pendingSource = useRef(
    new Map<string, { resolve: (body: string) => void; reject: (err: Error) => void }>(),
  );

  useEffect(() => {
    let disposed = false;
    const tabId = chrome.devtools.inspectedWindow.tabId;

    const connect = () => {
      if (disposed) return;
      const port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
      portRef.current = port;
      port.onMessage.addListener((msg: PortMessage) => {
        if (msg.kind === "frame" || msg.kind === "snapshot") store.ingest(msg.frame);
        if (msg.kind === "source") {
          const pending = pendingSource.current.get(msg.requestId);
          if (!pending) return;
          pendingSource.current.delete(msg.requestId);
          if (msg.body != null && !msg.error) pending.resolve(msg.body);
          else if (msg.body != null && msg.error === "truncated") pending.resolve(msg.body);
          else pending.reject(new Error(msg.error ?? "source fetch failed"));
        }
      });
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        if (!disposed) setTimeout(connect, 500);
      });
    };
    connect();

    configureSourceFetcher((url) => {
      return new Promise<string>((resolve, reject) => {
        const port = portRef.current;
        if (!port) {
          reject(new Error("panel port not connected"));
          return;
        }
        const requestId = crypto.randomUUID();
        pendingSource.current.set(requestId, { resolve, reject });
        try {
          port.postMessage({ kind: "source-request", requestId, url } satisfies PortMessage);
        } catch (err) {
          pendingSource.current.delete(requestId);
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        setTimeout(() => {
          if (!pendingSource.current.has(requestId)) return;
          pendingSource.current.delete(requestId);
          reject(new Error(`source fetch timeout: ${url}`));
        }, 10_000);
      });
    });

    const onNavigated = () => store.clear();
    chrome.devtools.network.onNavigated.addListener(onNavigated);

    return () => {
      disposed = true;
      configureSourceFetcher(undefined);
      chrome.devtools.network.onNavigated.removeListener(onNavigated);
      portRef.current?.disconnect();
    };
  }, [store]);

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
