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
    if (data.componentId === null) {
      if (waveTimers.length > 0) return;
      highlighter.hide();
    } else highlighter.show(fiber.domNodesOf(data.componentId));
  } else if (data.kind === "replay") {
    replayWave(data.componentIds);
  }
});

/**
 * Update Wave: flash a commit's components on the page, accumulating so the
 * render fanout builds up visibly. Bounded on every axis so a huge commit (a
 * few thousand components) can't wash the whole page purple or run for minutes,
 * and a new replay cancels any wave still in flight (back-to-back replays).
 */
let waveTimers: ReturnType<typeof setTimeout>[] = [];
const WAVE_MAX_GROUPS = 300; // components visualized per wave
const WAVE_MAX_NODES = 400; // boxes drawn at once (sliding window)
const WAVE_MAX_MS = 1600; // whole wave finishes within this

function cancelWave(): void {
  for (const t of waveTimers) clearTimeout(t);
  waveTimers = [];
  highlighter.hide();
}

function replayWave(ids: ReadonlyArray<number>): void {
  cancelWave();
  const capped = ids.slice(0, WAVE_MAX_GROUPS);
  const groups = capped
    .map((id) => fiber.domNodesOf(id as never))
    .filter((nodes) => nodes.length > 0);
  if (groups.length === 0) return;
  const step = Math.min(140, WAVE_MAX_MS / Math.max(1, groups.length));
  const acc: Node[] = [];
  acc.push(...groups[0]!);
  highlighter.show(acc);
  groups.forEach((nodes, i) => {
    if (i === 0) return;
    waveTimers.push(
      setTimeout(() => {
        acc.push(...nodes);
        if (acc.length > WAVE_MAX_NODES) acc.splice(0, acc.length - WAVE_MAX_NODES);
        highlighter.show(acc);
      }, i * step),
    );
  });
  waveTimers.push(setTimeout(cancelWave, groups.length * step + 800));
}
