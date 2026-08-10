import {
  PAGE_SOURCE,
  CONTENT_SOURCE,
  PAGE_PORT_NAME,
  type PageToContent,
  type PortMessage,
  type ContentToPage,
} from "../transport.js";

/**
 * ISOLATED-world bridge and DURABLE buffer.
 *
 * The content script lives and dies with the page, so — unlike the background
 * service worker, which MV3 terminates at will — it can safely hold the trace
 * until a panel is ready for it. It captures every frame the page emits into a
 * rolling buffer, (re)connects its port to the background proactively, and
 * replays the buffer whenever a panel pairs with the tab (`panel-ready`). That
 * makes delivery independent of service-worker lifecycle: the earlier design
 * flushed only on a fragile record ping and lost everything if the worker had
 * recycled between page load and the panel opening.
 */
const MAX_BUFFER = 4000;
const buffer: PortMessage[] = [];
let port: chrome.runtime.Port | null = null;
let panelReady = false;
let reconnectScheduled = false;

function record(msg: PortMessage): void {
  buffer.push(msg);
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

function connect(): void {
  let p: chrome.runtime.Port;
  try {
    p = chrome.runtime.connect({ name: PAGE_PORT_NAME });
  } catch {
    // Extension context invalidated (e.g. just reloaded) — retry shortly.
    scheduleReconnect();
    return;
  }
  port = p;
  p.onMessage.addListener((msg: PortMessage) => {
    if (msg.kind === "record") {
      const toPage: ContentToPage = { source: CONTENT_SOURCE, kind: "record", recording: msg.recording };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "snapshot-request") {
      const toPage: ContentToPage = { source: CONTENT_SOURCE, kind: "snapshot-request", renderId: msg.renderId };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "highlight") {
      const toPage: ContentToPage = { source: CONTENT_SOURCE, kind: "highlight", componentId: msg.componentId };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "replay") {
      const toPage: ContentToPage = { source: CONTENT_SOURCE, kind: "replay", componentIds: msg.componentIds };
      window.postMessage(toPage, "*");
    } else if (msg.kind === "panel-ready") {
      // A panel is listening: replay everything captured so far, then stream.
      panelReady = true;
      for (const m of buffer) p.postMessage(m);
    }
  });
  p.onDisconnect.addListener(() => {
    port = null;
    panelReady = false;
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectScheduled) return;
  reconnectScheduled = true;
  setTimeout(() => {
    reconnectScheduled = false;
    connect();
  }, 500);
}

// Connect eagerly and keep the port alive across service-worker restarts.
connect();

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as PageToContent | undefined;
  if (!data || data.source !== PAGE_SOURCE) return;

  // Snapshot responses are replies to a live panel request — relay straight
  // through, never buffered (they'd bloat the buffer and replay stale).
  if (data.kind === "snapshot") {
    if (port) {
      try {
        port.postMessage({ kind: "snapshot", frame: data.frame });
      } catch {
        port = null;
        panelReady = false;
        scheduleReconnect();
      }
    }
    return;
  }

  const msg: PortMessage | null =
    data.kind === "frame"
      ? { kind: "frame", frame: data.frame }
      : data.kind === "hello"
        ? { kind: "hello", reactVersion: data.reactVersion }
        : null;
  if (!msg) return;

  record(msg);
  if (panelReady && port) {
    try {
      port.postMessage(msg);
    } catch {
      // Port died between checks — drop to the buffer and reconnect.
      port = null;
      panelReady = false;
      scheduleReconnect();
    }
  }
});
