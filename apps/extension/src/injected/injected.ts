import { createSerializer } from "@react-lens/serializer";
import { createFiberBridge } from "@react-lens/fiber";
import { createInstrumentation } from "@react-lens/instrumentation";
import type { EventsBatchMessage } from "@react-lens/protocol";
import { PAGE_SOURCE, CONTENT_SOURCE, type ContentToPage } from "../transport.js";

/**
 * Runs in the MAIN world at document_start — before the page's React loads — so
 * the owned DevTools hook wins the hook slot. It starts recording IMMEDIATELY
 * (so the initial mount is captured even though the panel isn't open yet) and
 * buffers frames until a panel connects, then flushes the buffer and goes live.
 * This decouples capture from the panel-open handshake.
 */
type Frame = EventsBatchMessage["payload"];

const serializer = createSerializer();
const fiber = createFiberBridge(globalThis);
const instrumentation = createInstrumentation({ fiber, serializer });

const buffer: Frame[] = [];
const MAX_BUFFER = 4000;
let flushed = false;

function post(frame: Frame): void {
  window.postMessage({ source: PAGE_SOURCE, kind: "frame", frame }, "*");
}

function start(): void {
  if (instrumentation.isRecording()) return;
  instrumentation.start({
    captureDOM: true,
    interactionWindowMs: 200,
    onFrame: (frame) => {
      if (flushed) post(frame);
      else {
        buffer.push(frame);
        if (buffer.length > MAX_BUFFER) buffer.shift();
      }
    },
  });
  window.postMessage(
    { source: PAGE_SOURCE, kind: "hello", reactVersion: fiber.reactVersion() },
    "*",
  );
}

/** A panel connected: send everything captured so far, then stream live. */
function flush(): void {
  if (flushed) return;
  flushed = true;
  for (const frame of buffer) post(frame);
  buffer.length = 0;
}

// Install the hook and begin capturing right away.
fiber.install();
start();

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as ContentToPage | undefined;
  if (!data || data.source !== CONTENT_SOURCE) return;
  if (data.kind === "record") {
    if (data.recording) {
      start();
      flush();
    } else {
      instrumentation.stop();
    }
  }
});
