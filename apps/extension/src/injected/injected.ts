import { createSerializer } from "@react-lens/serializer";
import { createFiberBridge } from "@react-lens/fiber";
import { createInstrumentation } from "@react-lens/instrumentation";
import type { EventsBatchMessage } from "@react-lens/protocol";
import { PAGE_SOURCE, CONTENT_SOURCE, type ContentToPage } from "../transport.js";

/**
 * Runs in the MAIN world at document_start (injected natively via
 * chrome.scripting; see background). It captures commits and posts every frame
 * to the page window immediately — the ISOLATED content script owns the durable
 * buffer and decides when to forward to the panel. Keeping this side stateless
 * means capture never depends on the panel-open / service-worker handshake.
 */
type Frame = EventsBatchMessage["payload"];

const serializer = createSerializer();
const fiber = createFiberBridge(globalThis);
const instrumentation = createInstrumentation({ fiber, serializer });

// Reversible diagnostic surface, readable from the page console as
// `window.__REACT_LENS_DEBUG__`.
interface LensDebug {
  stubPresent: boolean;
  chained: boolean;
  framesProduced: number;
  totalInstances: number;
  framesPosted: number;
}
const debug: LensDebug = {
  stubPresent: false,
  chained: false,
  framesProduced: 0,
  totalInstances: 0,
  framesPosted: 0,
};
(globalThis as unknown as { __REACT_LENS_DEBUG__: LensDebug }).__REACT_LENS_DEBUG__ = debug;

function post(frame: Frame): void {
  debug.framesPosted++;
  window.postMessage({ source: PAGE_SOURCE, kind: "frame", frame }, "*");
}

function start(): void {
  if (instrumentation.isRecording()) return;
  const hook = (globalThis as unknown as {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: { _lensStub?: boolean; _lensChained?: boolean };
  }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  debug.stubPresent = hook?._lensStub === true;
  instrumentation.start({
    captureDOM: true,
    interactionWindowMs: 200,
    onFrame: (frame) => {
      debug.framesProduced++;
      debug.totalInstances += frame.instances.length;
      post(frame);
    },
  });
  debug.chained = hook?._lensChained === true;
  window.postMessage(
    { source: PAGE_SOURCE, kind: "hello", reactVersion: fiber.reactVersion() },
    "*",
  );
}

// Begin capturing right away. Do NOT call fiber.install() here first:
// instrumentation.start() installs the hook only AFTER subscribing to commits,
// so anything the document_start stub buffered before we loaded (a static app's
// initial mount) is replayed into a live listener instead of being lost.
start();

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as ContentToPage | undefined;
  if (!data || data.source !== CONTENT_SOURCE) return;
  if (data.kind === "record") {
    if (data.recording) start();
    else instrumentation.stop();
  }
});
