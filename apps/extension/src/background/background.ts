import { PAGE_PORT_NAME, PANEL_PORT_PREFIX, type PortMessage } from "../transport.js";

/**
 * Stateless relay (MV3 terminates it at will). Pairs a page port with the panel
 * port for the same tab and forwards messages both ways. All authoritative
 * state lives in the panel's trace store.
 */
interface Pair {
  page?: chrome.runtime.Port;
  panel?: chrome.runtime.Port;
}

const byTab = new Map<number, Pair>();

function pairFor(tabId: number): Pair {
  let pair = byTab.get(tabId);
  if (!pair) {
    pair = {};
    byTab.set(tabId, pair);
  }
  return pair;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PAGE_PORT_NAME) {
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined) return;
    const pair = pairFor(tabId);
    pair.page = port;

    port.onMessage.addListener((msg: PortMessage) => {
      pair.panel?.postMessage(msg);
    });
    port.onDisconnect.addListener(() => {
      pair.page = undefined;
    });
    return;
  }

  if (port.name.startsWith(PANEL_PORT_PREFIX)) {
    const tabId = Number(port.name.slice(PANEL_PORT_PREFIX.length));
    const pair = pairFor(tabId);
    pair.panel = port;

    // Ask the page to (re)start recording now that a panel is listening.
    pair.page?.postMessage({ kind: "record", recording: true } satisfies PortMessage);

    port.onMessage.addListener((msg: PortMessage) => {
      pair.page?.postMessage(msg);
    });
    port.onDisconnect.addListener(() => {
      pair.panel = undefined;
      pair.page?.postMessage({ kind: "record", recording: false } satisfies PortMessage);
    });
  }
});
