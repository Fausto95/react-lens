import {
  PAGE_SOURCE,
  CONTENT_SOURCE,
  PAGE_PORT_NAME,
  type PageToContent,
  type PortMessage,
  type ContentToPage,
} from "../transport.js";

/**
 * ISOLATED-world bridge. Relays page frames to the background over a
 * chrome.runtime port, and forwards record-control back to the page. Holds no
 * trace state — everything authoritative lives in the panel.
 */
let port: chrome.runtime.Port | null = null;

function connect(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: PAGE_PORT_NAME });
  p.onDisconnect.addListener(() => {
    port = null;
  });
  p.onMessage.addListener((msg: PortMessage) => {
    if (msg.kind === "record") {
      const toPage: ContentToPage = { source: CONTENT_SOURCE, kind: "record", recording: msg.recording };
      window.postMessage(toPage, "*");
    }
  });
  port = p;
  return p;
}

function ensurePort(): chrome.runtime.Port {
  return port ?? connect();
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as PageToContent | undefined;
  if (!data || data.source !== PAGE_SOURCE) return;

  try {
    if (data.kind === "frame") {
      ensurePort().postMessage({ kind: "frame", frame: data.frame } satisfies PortMessage);
    } else if (data.kind === "hello") {
      ensurePort().postMessage({ kind: "hello", reactVersion: data.reactVersion } satisfies PortMessage);
    }
  } catch {
    // Background was asleep; reconnect on the next frame.
    port = null;
  }
});
