import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TraceStore } from "@react-lens/trace-engine";
import { createCausality } from "@react-lens/causality";
import type { ComponentId, TimeTravelEntry, TimeTravelResult } from "@react-lens/protocol";
import { Panel, configureSourceFetcher } from "@react-lens/devtools/panel";
import type { EditApi, TimeTravelApi } from "@react-lens/devtools/panel";
import { PANEL_PORT_PREFIX, type EditPrimitive, type PortMessage } from "../transport.js";

/**
 * The DevTools panel. Owns the authoritative trace store on the panel side and
 * feeds it frames arriving over the background port for the inspected tab.
 */
function ExtensionPanel() {
  const store = useMemo(() => new TraceStore(), []);
  const causality = useMemo(() => createCausality(store), [store]);
  const [recording, setRecording] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [pickedId, setPickedId] = useState<ComponentId | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const pendingSource = useRef(
    new Map<string, { resolve: (body: string) => void; reject: (err: Error) => void }>(),
  );
  const pendingEdit = useRef(
    new Map<string, { resolve: (ok: boolean) => void; reject: (err: Error) => void }>(),
  );
  const pendingTravel = useRef(new Map<string, (result: TimeTravelResult) => void>());

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
          if (msg.body != null && (!msg.error || msg.error === "truncated")) pending.resolve(msg.body);
          else pending.reject(new Error(msg.error ?? "source fetch failed"));
        }
        if (msg.kind === "edit-result") {
          const pending = pendingEdit.current.get(msg.requestId);
          if (!pending) return;
          pendingEdit.current.delete(msg.requestId);
          if (msg.ok) pending.resolve(true);
          else pending.reject(new Error(msg.error ?? "edit failed"));
        }
        if (msg.kind === "time-travel-result") {
          const pending = pendingTravel.current.get(msg.requestId);
          if (pending) {
            pendingTravel.current.delete(msg.requestId);
            pending({
              applied: msg.applied,
              failed: msg.failed,
              supported: msg.supported,
              failures: msg.failures ?? [],
            });
          }
        }
        if (msg.kind === "inspect-picked") {
          setPickedId(msg.componentId);
          // Sticky inspect: stay in pick mode for roam + text edit.
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

    const onNavigated = () => {
      store.clear();
      setInspecting(false);
    };
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

  const editRequest = useCallback((build: (requestId: string) => PortMessage): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      const port = portRef.current;
      if (!port) {
        reject(new Error("panel port not connected"));
        return;
      }
      const requestId = crypto.randomUUID();
      pendingEdit.current.set(requestId, { resolve, reject });
      try {
        port.postMessage(build(requestId));
      } catch (err) {
        pendingEdit.current.delete(requestId);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      setTimeout(() => {
        if (!pendingEdit.current.has(requestId)) return;
        pendingEdit.current.delete(requestId);
        reject(new Error("edit timeout"));
      }, 5_000);
    });
  }, []);

  const edit: EditApi = useMemo(
    () => ({
      setProp: (id, path, value) => {
        void editRequest((requestId) => ({
          kind: "edit-setProp",
          requestId,
          componentId: id,
          path,
          value: value as EditPrimitive,
        }));
      },
      setHookState: (id, hookIndex, path, value) => {
        void editRequest((requestId) => ({
          kind: "edit-setHookState",
          requestId,
          componentId: id,
          hookIndex,
          path,
          value: value as EditPrimitive,
        }));
      },
    }),
    [editRequest],
  );

  /**
   * Time-travel request over the port. Never rejects — the panel controller
   * treats applies as fire-and-forget, so failures resolve to a zero result.
   */
  const travelRequest = useCallback(
    (build: (requestId: string) => PortMessage): Promise<TimeTravelResult> => {
      return new Promise((resolve) => {
        const nothing: TimeTravelResult = { applied: 0, failed: 0, supported: false, failures: [] };
        const port = portRef.current;
        if (!port) {
          resolve(nothing);
          return;
        }
        const requestId = crypto.randomUUID();
        pendingTravel.current.set(requestId, resolve);
        try {
          port.postMessage(build(requestId));
        } catch {
          pendingTravel.current.delete(requestId);
          resolve(nothing);
          return;
        }
        setTimeout(() => {
          if (!pendingTravel.current.has(requestId)) return;
          pendingTravel.current.delete(requestId);
          resolve(nothing);
        }, 5_000);
      });
    },
    [],
  );

  const timeTravel: TimeTravelApi = useMemo(
    () => ({
      // The renderer registers only once React loads, so probe (an empty apply
      // is a no-op page-side) and retry until the page answers supported.
      supported: async () => {
        for (let attempt = 0; attempt < 30; attempt++) {
          const result = await travelRequest((requestId) => ({
            kind: "time-travel-apply",
            requestId,
            entries: [],
          }));
          if (result.supported) return true;
          await new Promise((r) => setTimeout(r, 2_000));
        }
        return false;
      },
      apply: (entries: TimeTravelEntry[], atT?: number) =>
        travelRequest((requestId) => ({
          kind: "time-travel-apply",
          requestId,
          entries,
          ...(atT !== undefined ? { atT } : {}),
        })),
      goLive: () => travelRequest((requestId) => ({ kind: "time-travel-live", requestId })),
    }),
    [travelRequest],
  );

  const onToggleInspect = useCallback(() => {
    setInspecting((on) => {
      const next = !on;
      send({ kind: next ? "inspect-start" : "inspect-stop" });
      return next;
    });
  }, []);

  return (
    <Panel
      store={store}
      causality={causality}
      recording={recording}
      edit={edit}
      inspecting={inspecting}
      onToggleInspect={onToggleInspect}
      selectComponent={pickedId}
      onSelectConsumed={() => setPickedId(null)}
      onToggleRecording={() => {
        const next = !recording;
        setRecording(next);
        send({ kind: "record", recording: next });
      }}
      onRequestSnapshot={(renderId) => send({ kind: "snapshot-request", renderId })}
      onHighlight={(componentId) => send({ kind: "highlight", componentId })}
      onReplayCommit={(componentIds) => send({ kind: "replay", componentIds })}
      timeTravel={timeTravel}
    />
  );
}

createRoot(document.getElementById("root")!).render(<ExtensionPanel />);
