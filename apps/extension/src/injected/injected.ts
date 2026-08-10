import { createSerializer } from "@react-lens/serializer";
import { createFiberBridge } from "@react-lens/fiber";
import { createInstrumentation } from "@react-lens/instrumentation";
import { PAGE_SOURCE, CONTENT_SOURCE, type ContentToPage } from "../transport.js";

/**
 * Runs in the MAIN world at document_start — before the page's React loads — so
 * the owned DevTools hook wins the hook slot. Captures commits and interactions
 * and posts batched frames to the content script (never the app's live graph).
 */
const serializer = createSerializer();
const fiber = createFiberBridge(globalThis);
const instrumentation = createInstrumentation({ fiber, serializer });

// Install the hook immediately; hold off on recording until the panel opens.
fiber.install();

function startRecording() {
  if (instrumentation.isRecording()) return;
  instrumentation.start({
    captureDOM: true,
    interactionWindowMs: 200,
    onFrame: (frame) => {
      window.postMessage({ source: PAGE_SOURCE, kind: "frame", frame }, "*");
    },
  });
  window.postMessage(
    { source: PAGE_SOURCE, kind: "hello", reactVersion: fiber.reactVersion() },
    "*",
  );
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as ContentToPage | undefined;
  if (!data || data.source !== CONTENT_SOURCE) return;
  if (data.kind === "record") {
    if (data.recording) startRecording();
    else instrumentation.stop();
  }
});
