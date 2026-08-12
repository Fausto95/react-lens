import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import type {
  ComponentId,
  SourceLocation,
  TimeTravelEntry,
  TimeTravelResult,
} from "@reactlens/protocol";
import {
  Panel,
  configureSourceFetcher,
  configureComponentLocator,
  configureSourceRevealer,
} from "@reactlens/devtools/panel";
import type { EditApi, TimeTravelApi } from "@reactlens/devtools/panel";
import { isContextInvalidated, reconnectDelay } from "./connection.js";
import { PANEL_PORT_PREFIX, type EditPrimitive, type PortMessage } from "../transport.js";

/**
 * The DevTools panel. Owns the authoritative trace store on the panel side and
 * feeds it frames arriving over the background port for the inspected tab.
 */
function ExtensionPanel() {
  const store = useMemo(() => new TraceStore(), []);
  const causality = useMemo(() => createCausality(store), [store]);
  const [inspecting, setInspecting] = useState(false);
  const [pickedId, setPickedId] = useState<ComponentId | null>(null);
  /** The extension was reloaded under us; only reopening DevTools recovers. */
  const [connectionLost, setConnectionLost] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const pendingSource = useRef(
    new Map<string, { resolve: (body: string) => void; reject: (err: Error) => void }>(),
  );
  const pendingEdit = useRef(
    new Map<string, { resolve: (ok: boolean) => void; reject: (err: Error) => void }>(),
  );
  const pendingTravel = useRef(new Map<string, (result: TimeTravelResult) => void>());
  const pendingLocate = useRef(new Map<string, (loc: SourceLocation | null) => void>());

  useEffect(() => {
    let disposed = false;
    const tabId = chrome.devtools.inspectedWindow.tabId;

    let attempt = 0;
    const connect = () => {
      if (disposed) return;
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
      } catch (err) {
        // A reloaded or updated extension invalidates this panel's context for
        // good. Retrying only produces the same uncaught error forever, so say
        // what actually fixes it instead.
        if (isContextInvalidated(err)) {
          setConnectionLost(true);
          return;
        }
        setTimeout(connect, reconnectDelay(attempt++));
        return;
      }
      attempt = 0;
      portRef.current = port;
      // Capture is always on; re-assert after (re)connect in case an older
      // background left the page paused.
      try {
        port.postMessage({ kind: "record", recording: true } satisfies PortMessage);
      } catch {
        // onDisconnect / retry path will reconnect.
      }
      port.onMessage.addListener((msg: PortMessage) => {
        if (msg.kind === "frame" || msg.kind === "snapshot") store.ingest(msg.frame);
        if (msg.kind === "source") {
          const pending = pendingSource.current.get(msg.requestId);
          if (!pending) return;
          pendingSource.current.delete(msg.requestId);
          if (msg.body != null && (!msg.error || msg.error === "truncated"))
            pending.resolve(msg.body);
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
        if (msg.kind === "locate-source-result") {
          const pending = pendingLocate.current.get(msg.requestId);
          if (pending) {
            pendingLocate.current.delete(msg.requestId);
            pending(
              msg.file !== undefined && msg.line !== undefined
                ? { file: msg.file, line: msg.line, column: msg.column ?? 0 }
                : null,
            );
          }
        }
        if (msg.kind === "inspect-picked") {
          setPickedId(msg.componentId);
          // Sticky inspect: stay in pick mode for roam + text edit.
        }
      });
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        // `lastError` must be read here or Chrome logs it as unchecked.
        const err = chrome.runtime.lastError;
        if (err && isContextInvalidated(err)) {
          setConnectionLost(true);
          return;
        }
        if (!disposed) setTimeout(connect, reconnectDelay(attempt++));
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

  /**
   * Ask the page where a component is defined in the shipped bundle. Only
   * needed on production builds; dev builds answer from _debugStack already.
   */
  const locateRequest = useCallback((componentId: ComponentId): Promise<SourceLocation | null> => {
    return new Promise((resolve) => {
      const port = portRef.current;
      if (!port) {
        resolve(null);
        return;
      }
      const requestId = crypto.randomUUID();
      pendingLocate.current.set(requestId, resolve);
      try {
        port.postMessage({ kind: "locate-source", requestId, componentId } satisfies PortMessage);
      } catch {
        pendingLocate.current.delete(requestId);
        resolve(null);
        return;
      }
      setTimeout(() => {
        if (!pendingLocate.current.has(requestId)) return;
        pendingLocate.current.delete(requestId);
        resolve(null);
      }, 5_000);
    });
  }, []);

  useEffect(() => {
    configureComponentLocator(locateRequest);
    return () => configureComponentLocator(undefined);
  }, [locateRequest]);

  // Production sources live in the inspected page, not on this machine: reveal
  // them in the browser's own Sources panel, which applies sourcemaps itself.
  useEffect(() => {
    configureSourceRevealer(async (file, line, column) => {
      const panels = chrome.devtools?.panels as
        | { openResource?: (url: string, line: number, column: number) => void }
        | undefined;
      if (!panels?.openResource || !/^https?:\/\//.test(file)) return false;
      try {
        // DevTools counts from zero; our locations are 1-based lines.
        panels.openResource(file, Math.max(0, line - 1), Math.max(0, column));
        return true;
      } catch {
        return false;
      }
    });
    return () => configureSourceRevealer(undefined);
  }, []);

  const onToggleInspect = useCallback(() => {
    setInspecting((on) => {
      const next = !on;
      send({ kind: next ? "inspect-start" : "inspect-stop" });
      return next;
    });
  }, []);

  if (connectionLost) {
    // Nothing here is recoverable in place: this panel's extension context is
    // gone, so the store will never receive another frame. Say what happened
    // and what fixes it, rather than showing a panel frozen on stale data.
    return (
      <div className="rl-lost">
        <h1>React Lens disconnected</h1>
        <p>
          The extension was reloaded or updated, which invalidates this panel. Close and reopen
          DevTools to reconnect.
        </p>
        <button type="button" onClick={() => location.reload()}>
          Reload panel
        </button>
      </div>
    );
  }

  return (
    <Panel
      store={store}
      causality={causality}
      recording
      edit={edit}
      inspecting={inspecting}
      onToggleInspect={onToggleInspect}
      selectComponent={pickedId}
      onSelectConsumed={() => setPickedId(null)}
      onRequestSnapshot={(renderId) => send({ kind: "snapshot-request", renderId })}
      onHighlight={(componentId, opts) =>
        send({ kind: "highlight", componentId, ...(opts?.reveal ? { reveal: true } : {}) })
      }
      onReplayCommit={(componentIds) => send({ kind: "replay", componentIds })}
      timeTravel={timeTravel}
    />
  );
}

createRoot(document.getElementById("root")!).render(<ExtensionPanel />);
