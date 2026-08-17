/* oxlint-disable react/react-compiler -- WAL client closes over session/port refs; factory is intentionally render-stable */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
import {
  ErrorBoundary,
  installGlobalErrorHandlers,
  reportError,
  reportNotice,
} from "@reactlens/devtools/errors";
import { createTraceClient, TraceProvider } from "@reactlens/devtools/trace";
import { isContextInvalidated, reconnectDelay } from "../connection.js";
import {
  INITIAL_SESSION,
  commitFrame,
  failFrame,
  resyncRequest,
  stepSession,
  type SessionState,
} from "./session.js";
import { PANEL_PORT_PREFIX, type EditPrimitive, type PortMessage } from "../transport.js";
import { createHeartbeat, type Heartbeat } from "../heartbeat.js";

/** Trailing window for cursor acks — the page only needs the newest one. */
const ACK_INTERVAL_MS = 250;

/**
 * The DevTools panel. Prefers a worker-backed TraceClient (authoritative store
 * + WAL off-thread) with a main-thread cache for sync UI reads; falls back to a
 * plain TraceStore when the worker cannot spawn.
 */
function ExtensionPanel() {
  const sessionRef = useRef<SessionState>(INITIAL_SESSION);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAck = useCallback((port: chrome.runtime.Port) => {
    if (ackTimerRef.current !== null) return;
    ackTimerRef.current = setTimeout(() => {
      ackTimerRef.current = null;
      const { sessionId, fromSeq } = resyncRequest(sessionRef.current);
      if (sessionId === null || fromSeq <= 0) return;
      try {
        port.postMessage({ kind: "ack", sessionId, seq: fromSeq } satisfies PortMessage);
      } catch (err) {
        reportError("ack", err);
      }
    }, ACK_INTERVAL_MS);
  }, []);

  const { store, causality, client } = useMemo(() => {
    return createTraceClient({
      durableWal: true,
      wal: {
        onDurable: (sessionId, seqs) => {
          if (sessionId !== sessionRef.current.sessionId) return;
          for (const seq of seqs) {
            sessionRef.current = commitFrame(sessionRef.current, seq);
          }
          const port = portRef.current;
          if (port) scheduleAck(port);
        },
        onFailed: (sessionId, seqs) => {
          if (sessionId !== sessionRef.current.sessionId) return;
          for (const seq of seqs) {
            sessionRef.current = failFrame(sessionRef.current, seq);
          }
          reportError("wal", new Error("could not persist frames — storage is unavailable"));
        },
        onDropped: (count) =>
          reportNotice(
            "trace",
            `${count} of the oldest frames left the recovery log (size budget).`,
          ),
        onRecovered: (recovered) => {
          if (!recovered) return;
          sessionRef.current = {
            sessionId: recovered.sessionId,
            lastSeq: recovered.lastSeq,
            gapAt: null,
            ahead: [],
          };
          reportNotice(
            "recovery",
            `Recovered ${recovered.frames.length} frames from the previous panel session.`,
          );
        },
        onResync: () => {
          // Worker respawned (<1s target): ask the page for anything not yet durable.
          const port = portRef.current;
          if (!port) return;
          try {
            port.postMessage(resyncRequest(sessionRef.current));
          } catch (err) {
            reportError("resync", err);
          }
        },
      },
    });
  }, [scheduleAck]);

  useEffect(() => () => client.dispose(), [client]);

  const [inspecting, setInspecting] = useState(false);
  const [pickedId, setPickedId] = useState<ComponentId | null>(null);
  /** The extension was reloaded under us; only reopening DevTools recovers. */
  const [connectionLost, setConnectionLost] = useState(false);
  const heartbeatRef = useRef<Heartbeat | null>(null);
  /** Lets the recovery screen retry in place instead of demanding a reopen. */
  const reconnectRef = useRef<(() => void) | null>(null);
  /** How many times each seq has failed ingest — twice → quarantine. */
  const poisonRef = useRef(new Map<number, number>());
  const pendingSource = useRef(
    new Map<string, { resolve: (body: string) => void; reject: (err: Error) => void }>(),
  );
  const pendingEdit = useRef(
    new Map<string, { resolve: (ok: boolean) => void; reject: (err: Error) => void }>(),
  );
  const pendingTravel = useRef(new Map<string, (result: TimeTravelResult) => void>());
  const pendingLocate = useRef(new Map<string, (loc: SourceLocation | null) => void>());

  // Anything that escapes React — a throw in a port listener, a rejection
  // nobody awaited — lands in the same ring the boundaries report to, so the
  // toolbar chip is the whole truth about what broke.
  useEffect(() => installGlobalErrorHandlers(window), []);

  useEffect(() => {
    let disposed = false;
    const tabId = chrome.devtools.inspectedWindow.tabId;

    /**
     * Fold a port message into the page session, then perform what it asks.
     * The reset arrives in order with the frames, so a reload can't wipe the
     * new document's mount (which is what watching `onNavigated` did).
     */
    const applySession = (port: chrome.runtime.Port, msg: PortMessage) => {
      const before = resyncRequest(sessionRef.current).fromSeq;
      const { state, actions } = stepSession(sessionRef.current, msg);
      sessionRef.current = state;
      for (const action of actions) {
        if (action.type === "ingest") {
          // The cursor is the panel's only record of what it holds, so it may
          // only advance over a frame the store actually took. A throw here
          // used to lose that frame permanently.
          try {
            if (state.sessionId !== null) {
              client.ingest(action.frame, { sessionId: state.sessionId, seq: action.seq });
            } else {
              client.ingest(action.frame);
              sessionRef.current = commitFrame(sessionRef.current, action.seq);
            }
            poisonRef.current.delete(action.seq);
          } catch (err) {
            const fails = (poisonRef.current.get(action.seq) ?? 0) + 1;
            poisonRef.current.set(action.seq, fails);
            if (fails >= 2) {
              // Same seq crashed twice — skip it, keep the session alive.
              sessionRef.current = commitFrame(sessionRef.current, action.seq);
              reportNotice(
                "poison",
                `Skipped poison frame seq ${action.seq} after repeated ingest failures.`,
              );
            } else {
              sessionRef.current = failFrame(sessionRef.current, action.seq);
              reportError("ingest", err);
            }
            continue;
          }
          // Durability (and therefore ack) is owned by the trace worker WAL —
          // onDurable/onFailed handlers advance the session cursor.
        } else if (action.type === "reset-store") {
          // Keep prior documents as stitchable segments (Phase 3) instead of
          // wiping the session forever. Live UI still shows only the new doc.
          void client.beginSegment(action.previousSessionId, action.nextSessionId);
          poisonRef.current.clear();
          setInspecting(false);
          setPickedId(null);
        } else if (action.type === "protocol-mismatch") {
          reportError(
            "protocol",
            new Error(
              `Page speaks protocol v${action.protocolVersion}; this panel expects a compatible version. Reload DevTools after updating the extension.`,
            ),
          );
          setConnectionLost(true);
        } else if (action.type === "resync") {
          try {
            port.postMessage(resyncRequest(sessionRef.current));
          } catch (err) {
            // onDisconnect / retry path will reconnect.
            reportError("resync", err);
          }
        }
      }

      // Tell the page how far it can forget. Without this the page-side buffer
      // retains the whole session and spills to storage for no reason.
      if (resyncRequest(sessionRef.current).fromSeq > before) scheduleAck(port);
    };

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
      portRef.current = port;
      // A port that stops answering is worse than one that closes: frames go
      // into it while the panel believes it is connected. Force the close so
      // the reconnect-and-resync path runs.
      const beat = createHeartbeat({
        send: (id) => {
          try {
            port.postMessage({ kind: "ping", id } satisfies PortMessage);
          } catch {
            // onDisconnect handles it.
          }
        },
        onDead: () => {
          reportError("heartbeat", new Error("port stopped answering — reconnecting"));
          try {
            port.disconnect();
          } catch {
            // Already gone.
          }
          if (portRef.current === port) {
            portRef.current = null;
            if (!disposed) setTimeout(connect, reconnectDelay(attempt++));
          }
        },
      });
      heartbeatRef.current?.stop();
      heartbeatRef.current = beat;
      // Capture is always on; re-assert after (re)connect in case an older
      // background left the page paused. Then ask the page for whatever we
      // missed while the port was down — the panel owns that cursor, because
      // anything the content script sent into a dead port never arrived.
      try {
        port.postMessage({ kind: "record", recording: true } satisfies PortMessage);
        port.postMessage(resyncRequest(sessionRef.current));
      } catch (err) {
        // onDisconnect / retry path will reconnect.
        reportError("connect", err);
      }
      port.onMessage.addListener((msg: PortMessage) => {
        if (msg.kind === "pong") {
          beat.pong(msg.id);
          // Proven, not merely opened: resetting on `connect()` returning made
          // a port that dies immediately reset the backoff every attempt.
          attempt = 0;
          return;
        }
        if (msg.kind === "ping") {
          try {
            port.postMessage({ kind: "pong", id: msg.id } satisfies PortMessage);
          } catch {
            // onDisconnect handles it.
          }
          return;
        }
        if (msg.kind === "compacted") {
          // Retention has a floor, and the user has to know when it was hit —
          // a timeline that silently skips a minute is worse than one that says
          // it did.
          reportNotice(
            "trace",
            `${msg.frames} frames (seq ${msg.fromSeq}–${msg.toSeq}) could not be retained while ` +
              `the panel was away: memory and extension storage were both full.`,
          );
          return;
        }
        applySession(port, msg);
        // On-demand snapshots answer a request; they carry no sequence.
        if (msg.kind === "snapshot") client.ingest(msg.frame);
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
              storesApplied: msg.storesApplied ?? 0,
              storeFailures: msg.storeFailures ?? [],
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
        beat.stop();
        // `lastError` must be read here or Chrome logs it as unchecked.
        const err = chrome.runtime.lastError;
        if (err && isContextInvalidated(err)) {
          setConnectionLost(true);
          return;
        }
        if (!disposed) setTimeout(connect, reconnectDelay(attempt++));
      });
    };
    reconnectRef.current = connect;

    /**
     * Bring the worker WAL up before the port, so `panel-ready` carries the
     * cursor we recovered rather than 0. Capture never stopped page-side, so
     * the wait costs a slightly later first paint and loses nothing.
     */
    void (async () => {
      await client.whenReady();
      if (!disposed) connect();
    })();

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

    // Navigation is handled in-band, by the page session id on the frames
    // themselves. Clearing from `chrome.devtools.network.onNavigated` raced the
    // new document's first frames and could wipe its mount — leaving the panel
    // empty for a page that was in fact streaming.

    return () => {
      disposed = true;
      configureSourceFetcher(undefined);
      if (ackTimerRef.current !== null) clearTimeout(ackTimerRef.current);
      heartbeatRef.current?.stop();
      heartbeatRef.current = null;
      reconnectRef.current = null;
      // Flush worker WAL before closing: frames queued in the trailing window
      // are exactly the ones a recovery would otherwise be missing.
      void client.flushWal();
      portRef.current?.disconnect();
    };
  }, [client, scheduleAck, sessionRef, portRef, ackTimerRef]);

  const send = (msg: PortMessage) => {
    const port = portRef.current;
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch (err) {
      portRef.current = null;
      reportError("send", err);
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
        const nothing: TimeTravelResult = {
          applied: 0,
          failed: 0,
          supported: false,
          failures: [],
          storesApplied: 0,
          storeFailures: [],
        };
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

  const onToggleInspect = () => {
    setInspecting((on) => {
      const next = !on;
      send({ kind: next ? "inspect-start" : "inspect-stop" });
      return next;
    });
  };

  if (connectionLost) {
    // Usually terminal — a reloaded extension invalidates this panel's context
    // for good — but "usually" is not "always": the same signal shows up when a
    // reload happens to land between two connects. Offer the cheap retry first
    // and keep the reopen instruction for when it fails.
    return (
      <div className="rl-lost">
        <h1>React Lens disconnected</h1>
        <p>
          The extension was reloaded or updated, which invalidates this panel. Try reconnecting; if
          that fails, close and reopen DevTools.
        </p>
        <button
          type="button"
          className="rl-lost-primary"
          onClick={() => {
            setConnectionLost(false);
            reconnectRef.current?.();
          }}
        >
          Reconnect
        </button>
        <button type="button" onClick={() => location.reload()}>
          Reload panel
        </button>
      </div>
    );
  }

  // The port effect lives above this boundary on purpose: when the UI throws,
  // ingest keeps running and the store keeps filling, so "Retry" renders
  // everything that arrived in the meantime instead of a truncated trace.
  return (
    <TraceProvider client={client}>
      <ErrorBoundary scope="panel">
        <Panel
          store={store}
          causality={causality}
          traceClient={client}
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
      </ErrorBoundary>
    </TraceProvider>
  );
}

createRoot(document.getElementById("root")!).render(<ExtensionPanel />);
