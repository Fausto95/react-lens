import {
  PAGE_SOURCE,
  CONTENT_SOURCE,
  PAGE_PORT_NAME,
  type PageToContent,
  type PortMessage,
  type ContentToPage,
  type SequencedMessage,
  type Unsequenced,
} from "../transport.js";
import { createMessageBuffer } from "./buffer.js";
import { createChromeSpillStore } from "./spill.js";
import { reconnectDelay } from "../connection.js";
import { createHeartbeat, type Heartbeat } from "../heartbeat.js";

/**
 * ISOLATED-world bridge and DURABLE buffer.
 *
 * Capture in the page never stops, so this buffer holds the session while the
 * panel is away (DevTools closed, MV3 worker recycled, tab backgrounded). The
 * panel resumes from its own cursor and acknowledges what it kept, and the
 * overflow spills to extension storage rather than being dropped — see
 * `createMessageBuffer`.
 */
const buffer = createMessageBuffer(4000, createChromeSpillStore() ?? undefined);
let port: chrome.runtime.Port | null = null;
let panelReady = false;
let reconnectScheduled = false;
/** Consecutive failed connects, for the shared backoff. */
let attempt = 0;
let heartbeat: Heartbeat | null = null;
/** The compaction we have already told the panel about. */
let reportedCompactionTo = 0;

function connect(): void {
  let p: chrome.runtime.Port;
  try {
    p = chrome.runtime.connect({ name: PAGE_PORT_NAME });
  } catch {
    scheduleReconnect();
    return;
  }
  port = p;
  heartbeat?.stop();
  heartbeat = createHeartbeat({
    send: (id) => relayLive({ kind: "ping", id }),
    // A port the background stopped answering on is worse than a closed one:
    // frames vanish into it while both sides believe they are connected.
    onDead: () => {
      try {
        p.disconnect();
      } catch {
        // Already gone; onDisconnect may not fire for a self-initiated close.
      }
      if (port === p) {
        port = null;
        panelReady = false;
        scheduleReconnect();
      }
    },
  });
  p.onMessage.addListener((msg: PortMessage) => {
    if (msg.kind === "record") {
      const toPage: ContentToPage = {
        source: CONTENT_SOURCE,
        kind: "record",
        recording: msg.recording,
      };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "snapshot-request") {
      const toPage: ContentToPage = {
        source: CONTENT_SOURCE,
        kind: "snapshot-request",
        renderId: msg.renderId,
      };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "source-request") {
      const toPage: ContentToPage = {
        source: CONTENT_SOURCE,
        kind: "source-request",
        requestId: msg.requestId,
        url: msg.url,
      };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "highlight") {
      const toPage: ContentToPage = {
        source: CONTENT_SOURCE,
        kind: "highlight",
        componentId: msg.componentId,
        ...(msg.reveal ? { reveal: true } : {}),
      };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "replay") {
      const toPage: ContentToPage = {
        source: CONTENT_SOURCE,
        kind: "replay",
        componentIds: msg.componentIds,
      };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "inspect-start") {
      window.postMessage(
        { source: CONTENT_SOURCE, kind: "inspect-start" } satisfies ContentToPage,
        "*",
      );
    } else if (msg.kind === "inspect-stop") {
      window.postMessage(
        { source: CONTENT_SOURCE, kind: "inspect-stop" } satisfies ContentToPage,
        "*",
      );
    } else if (msg.kind === "edit-setProp") {
      window.postMessage(
        {
          source: CONTENT_SOURCE,
          kind: "edit-setProp",
          requestId: msg.requestId,
          componentId: msg.componentId,
          path: msg.path,
          value: msg.value,
        } satisfies ContentToPage,
        "*",
      );
    } else if (msg.kind === "edit-setHookState") {
      window.postMessage(
        {
          source: CONTENT_SOURCE,
          kind: "edit-setHookState",
          requestId: msg.requestId,
          componentId: msg.componentId,
          hookIndex: msg.hookIndex,
          path: msg.path,
          value: msg.value,
        } satisfies ContentToPage,
        "*",
      );
    } else if (msg.kind === "edit-setText") {
      window.postMessage(
        {
          source: CONTENT_SOURCE,
          kind: "edit-setText",
          requestId: msg.requestId,
          componentId: msg.componentId,
          text: msg.text,
        } satisfies ContentToPage,
        "*",
      );
    } else if (msg.kind === "locate-source") {
      window.postMessage(
        {
          source: CONTENT_SOURCE,
          kind: "locate-source",
          requestId: msg.requestId,
          componentId: msg.componentId,
        } satisfies ContentToPage,
        "*",
      );
    } else if (msg.kind === "time-travel-apply") {
      window.postMessage(
        {
          source: CONTENT_SOURCE,
          kind: "time-travel-apply",
          requestId: msg.requestId,
          entries: msg.entries,
          ...(msg.atT !== undefined ? { atT: msg.atT } : {}),
        } satisfies ContentToPage,
        "*",
      );
    } else if (msg.kind === "time-travel-live") {
      window.postMessage(
        {
          source: CONTENT_SOURCE,
          kind: "time-travel-live",
          requestId: msg.requestId,
        } satisfies ContentToPage,
        "*",
      );
    } else if (msg.kind === "pong") {
      heartbeat?.pong(msg.id);
      // Proven, not merely opened: a port that dies on arrival must not reset
      // the backoff and turn the retry loop into a spin.
      attempt = 0;
    } else if (msg.kind === "ping") {
      relayLive({ kind: "pong", id: msg.id });
    } else if (msg.kind === "ack") {
      // Only the current document's cursor means anything here.
      if (msg.sessionId === buffer.sessionId) void buffer.ack(msg.seq);
    } else if (msg.kind === "panel-ready") {
      panelReady = true;
      // The panel carries the cursor: send only what it is missing. A session
      // it never saw (or a reloaded document) replays from the start.
      const from = msg.sessionId !== null && msg.sessionId === buffer.sessionId ? msg.fromSeq : 0;
      void replay(p, from);
    }
  });
  p.onDisconnect.addListener(() => {
    port = null;
    panelReady = false;
    heartbeat?.stop();
    heartbeat = null;
    // The panel may have closed mid-scrub — never leave the app stuck in the
    // past with recording suppressed.
    window.postMessage(
      {
        source: CONTENT_SOURCE,
        kind: "time-travel-live",
        requestId: "auto-disconnect",
      } satisfies ContentToPage,
      "*",
    );
    scheduleReconnect();
  });
}

/**
 * Send the panel the tail it is missing, then tell it about anything nothing
 * could retain. Reading back spilled chunks is async, so this must not race a
 * second replay request.
 */
async function replay(p: chrome.runtime.Port, fromSeq: number): Promise<void> {
  const missing = await buffer.since(fromSeq);
  if (port !== p) return;
  for (const m of missing) {
    try {
      p.postMessage(m);
    } catch {
      // The port died mid-replay. The panel's cursor is unchanged for anything
      // it did not receive, so its next resync asks for the same range again.
      return;
    }
  }
  const compacted = buffer.compacted;
  if (compacted && compacted.toSeq > reportedCompactionTo && buffer.sessionId) {
    reportedCompactionTo = compacted.toSeq;
    relayLive({ kind: "compacted", sessionId: buffer.sessionId, ...compacted });
  }
}

function scheduleReconnect(): void {
  if (reconnectScheduled) return;
  reconnectScheduled = true;
  // Shared backoff with the panel: a flat 500ms retry against a worker that is
  // gone for good is just noise.
  setTimeout(() => {
    reconnectScheduled = false;
    connect();
  }, reconnectDelay(attempt++));
}

connect();

function relayLive(msg: PortMessage): void {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch {
    port = null;
    panelReady = false;
    scheduleReconnect();
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as PageToContent | undefined;
  if (!data || data.source !== PAGE_SOURCE) return;

  if (data.kind === "snapshot") {
    relayLive({ kind: "snapshot", frame: data.frame });
    return;
  }
  if (data.kind === "locate-source-result") {
    relayLive({
      kind: "locate-source-result",
      requestId: data.requestId,
      componentId: data.componentId,
      ...(data.file !== undefined ? { file: data.file } : {}),
      ...(data.line !== undefined ? { line: data.line } : {}),
      ...(data.column !== undefined ? { column: data.column } : {}),
    });
    return;
  }
  if (data.kind === "source") {
    relayLive({
      kind: "source",
      requestId: data.requestId,
      url: data.url,
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
    });
    return;
  }
  if (data.kind === "inspect-picked") {
    relayLive({
      kind: "inspect-picked",
      componentId: data.componentId,
      name: data.name,
      ...(data.sourceFile ? { sourceFile: data.sourceFile } : {}),
      ...(data.sourceLine != null ? { sourceLine: data.sourceLine } : {}),
    });
    return;
  }
  if (data.kind === "time-travel-result") {
    relayLive({
      kind: "time-travel-result",
      requestId: data.requestId,
      applied: data.applied,
      failed: data.failed,
      supported: data.supported,
      failures: data.failures,
    });
    return;
  }
  if (data.kind === "edit-result") {
    relayLive({
      kind: "edit-result",
      requestId: data.requestId,
      ok: data.ok,
      ...(data.mode ? { mode: data.mode } : {}),
      ...(data.error ? { error: data.error } : {}),
    });
    return;
  }

  const unsequenced: Unsequenced<SequencedMessage> | null =
    data.kind === "frame"
      ? { kind: "frame", frame: data.frame, sessionId: data.sessionId }
      : data.kind === "hello"
        ? { kind: "hello", reactVersion: data.reactVersion, sessionId: data.sessionId }
        : null;
  if (!unsequenced) return;

  // Buffer first, always: the cursor is what makes the panel's reconnect
  // lossless, so a message must be retained even if this send succeeds.
  const msg = buffer.push(unsequenced);
  if (panelReady && port) {
    try {
      port.postMessage(msg);
    } catch {
      port = null;
      panelReady = false;
      scheduleReconnect();
    }
  }
});
