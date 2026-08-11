import { PAGE_PORT_NAME, PANEL_PORT_PREFIX, type PortMessage } from "../transport.js";
import { registerWithRetry } from "./register.js";

/**
 * Inject the MAIN-world scripts natively via chrome.scripting rather than as
 * @crxjs content scripts. Two reasons crxjs can't do this job:
 *  1. It wraps content scripts in an `await import(chrome.runtime.getURL(...))`
 *     loader, but MAIN-world scripts have NO chrome.* APIs — so the loader
 *     throws `chrome is not defined` and the bridge never runs.
 *  2. Even setting that aside, the async import lands after the page's React
 *     has already read (and cached the absence of) the DevTools hook.
 * Native registration injects the raw files at document_start with no wrapper,
 * so the stub wins the hook slot before React evaluates and the self-contained
 * bridge (dist/injected.js, built by vite.injected.config.ts) then drives it.
 */
const MAIN_SCRIPTS: chrome.scripting.RegisteredContentScript[] = [
  {
    id: "react-lens-hook",
    matches: ["<all_urls>"],
    js: ["lens-hook.js"],
    runAt: "document_start",
    world: "MAIN",
    allFrames: true,
  },
  {
    id: "react-lens-bridge",
    matches: ["<all_urls>"],
    js: ["injected.js"],
    runAt: "document_start",
    world: "MAIN",
    allFrames: true,
  },
];

// The registration persists across sessions, so re-registering throws
// "Duplicate script ID". Unregister-then-register makes it idempotent, and a
// single top-level call (once per service-worker cold start) avoids the
// concurrent double-registration that multiple event listeners would cause.
async function registerMainScripts(): Promise<void> {
  const ids = MAIN_SCRIPTS.map((s) => s.id);
  const result = await registerWithRetry(async () => {
    try {
      await chrome.scripting.unregisterContentScripts({ ids });
    } catch {
      // Nothing registered yet — expected on first run.
    }
    await chrome.scripting.registerContentScripts(MAIN_SCRIPTS);
  });

  if (result.ok) return;

  // Out of retries. Say what this means rather than printing a bare rejection:
  // without these scripts the hook never installs, so the panel will sit empty
  // and the cause is nowhere near the symptom.
  console.error(
    "[react-lens] could not register the MAIN-world scripts, so React Lens will not " +
      "attach to pages. Reload the extension from chrome://extensions to retry.",
    result.error,
  );
}

void registerMainScripts();

// The worker is terminated at will and these registrations are what make the
// extension work at all, so re-assert them at every lifecycle point Chrome
// offers rather than only on a cold start that may have raced its own startup.
chrome.runtime.onInstalled.addListener(() => void registerMainScripts());
chrome.runtime.onStartup.addListener(() => void registerMainScripts());

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

    // If a panel is already listening (page reloaded, or worker restarted and
    // the content script reconnected), ask the content buffer to replay.
    if (pair.panel) port.postMessage({ kind: "panel-ready" } satisfies PortMessage);

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

    // Tell the content script to replay its durable buffer now that a panel is
    // listening — this is what surfaces the already-captured tree.
    pair.page?.postMessage({ kind: "panel-ready" } satisfies PortMessage);

    port.onMessage.addListener((msg: PortMessage) => {
      pair.page?.postMessage(msg);
    });
    port.onDisconnect.addListener(() => {
      pair.panel = undefined;
      pair.page?.postMessage({ kind: "record", recording: false } satisfies PortMessage);
    });
  }
});
