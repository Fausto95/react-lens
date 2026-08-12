import { PAGE_PORT_NAME, PANEL_PORT_PREFIX, type PortMessage } from "../transport.js";
import {
  commandsOnPageConnect,
  commandsOnPanelConnect,
  commandsOnPanelDisconnect,
} from "./pairing.js";
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

/**
 * Post without letting a dying port throw out of the listener.
 *
 * A port can be torn down between the sender's check and our post; the
 * exception then escapes into Chrome's dispatch, which aborts the rest of this
 * message's handling. The peer resyncs from its own cursor, so dropping one
 * post here is recoverable — losing the handler is not.
 */
function post(port: chrome.runtime.Port | undefined, msg: PortMessage): void {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch {
    // Its onDisconnect will clear the pair.
  }
}

/**
 * Liveness probes are answered by the immediate peer, never relayed. The point
 * is to prove *this* hop is alive; forwarding would make the answer depend on
 * whether the other end of the pair happens to be attached.
 */
function answeredPing(port: chrome.runtime.Port, msg: PortMessage): boolean {
  if (msg.kind !== "ping") return false;
  post(port, { kind: "pong", id: msg.id });
  return true;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PAGE_PORT_NAME) {
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined) return;
    const pair = pairFor(tabId);
    pair.page = port;

    // A panel may already be listening (page reloaded, or the worker restarted
    // and the content script reconnected). Tell it a page is live again; it
    // replies with its own cursor, which is the only thing that knows what it
    // is missing.
    if (pair.panel) {
      for (const cmd of commandsOnPageConnect()) {
        post(pair.panel, cmd satisfies PortMessage);
      }
    }

    port.onMessage.addListener((msg: PortMessage) => {
      if (answeredPing(port, msg)) return;
      post(pair.panel, msg);
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

    // Make sure the page is capturing. The panel sends its own `panel-ready`
    // (with the cursor) as soon as it connects, which is what surfaces the
    // already-captured tree.
    for (const cmd of commandsOnPanelConnect()) {
      post(pair.page, cmd satisfies PortMessage);
    }

    port.onMessage.addListener((msg: PortMessage) => {
      if (answeredPing(port, msg)) return;
      post(pair.page, msg);
    });
    port.onDisconnect.addListener(() => {
      pair.panel = undefined;
      // Do not stop page capture — the content script keeps buffering so
      // activity while DevTools is closed is still available on reconnect.
      for (const cmd of commandsOnPanelDisconnect()) {
        post(pair.page, cmd satisfies PortMessage);
      }
    });
  }
});
