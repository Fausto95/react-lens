import { createSerializer } from "@react-lens/serializer";
import { createFiberBridge } from "@react-lens/fiber";
import { createInstrumentation } from "@react-lens/instrumentation";
import type { EventsBatchMessage } from "@react-lens/protocol";
import { PAGE_SOURCE, CONTENT_SOURCE, type ContentToPage } from "../transport.js";
import { createHighlighter } from "./highlighter.js";

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
const highlighter = createHighlighter();

function post(frame: Frame): void {
  window.postMessage({ source: PAGE_SOURCE, kind: "frame", frame }, "*");
}

function start(): void {
  if (instrumentation.isRecording()) return;
  instrumentation.start({
    captureDOM: true,
    interactionWindowMs: 200,
    // Stream only the lightweight tree (events + instances). Full per-render
    // snapshots — props/hooks/state/DOM — are fetched on demand (see the
    // snapshot-request handler); streaming them inline melts large apps, whose
    // single mount commit can serialize tens of MB across postMessage.
    streamSnapshots: false,
    onFrame: (frame) => post(frame),
  });
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
  } else if (data.kind === "snapshot-request") {
    const snapshot = instrumentation.snapshot(data.renderId);
    if (!snapshot) return;
    window.postMessage(
      {
        source: PAGE_SOURCE,
        kind: "snapshot",
        frame: { events: [], snapshots: [snapshot], instances: [] },
      },
      "*",
    );
  } else if (data.kind === "highlight") {
    if (data.componentId === null) highlighter.hide();
    else highlighter.show(fiber.domNodesOf(data.componentId));
  }
});
