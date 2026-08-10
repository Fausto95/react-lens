import { PAGE_PORT_NAME, PANEL_PORT_PREFIX, type PortMessage } from "../transport.js";

/**
 * Register the synchronous hook stub as a MAIN-world script at document_start.
 * We do this natively via chrome.scripting rather than as a @crxjs content
 * script because @crxjs wraps content scripts in an `await import(...)` loader —
 * that runs too late, after the page's React has already read (and cached the
 * absence of) the DevTools hook. Native registration injects the raw file with
 * no wrapper, so the stub reliably wins the hook slot before React evaluates.
 */
const HOOK_SCRIPT_ID = "react-lens-hook";

async function registerHookStub(): Promise<void> {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [HOOK_SCRIPT_ID] });
    if (existing.length > 0) return;
    await chrome.scripting.registerContentScripts([
      {
        id: HOOK_SCRIPT_ID,
        matches: ["<all_urls>"],
        js: ["lens-hook.js"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: true,
      },
    ]);
  } catch (err) {
    console.error("[react-lens] failed to register hook stub", err);
  }
}

chrome.runtime.onInstalled.addListener(() => void registerHookStub());
chrome.runtime.onStartup.addListener(() => void registerHookStub());
// Also on first service-worker spin-up (covers unpacked reloads).
void registerHookStub();

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

    // If a panel is already listening (e.g. the page reloaded), tell the fresh
    // page to start/flush immediately.
    if (pair.panel) port.postMessage({ kind: "record", recording: true } satisfies PortMessage);

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
