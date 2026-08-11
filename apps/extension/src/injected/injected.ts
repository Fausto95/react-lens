import { createSerializer } from "@reactlens/serializer";
import { createFiberBridge } from "@reactlens/fiber";
import { createInstrumentation } from "@reactlens/instrumentation";
import type { EventsBatchMessage, ComponentId } from "@reactlens/protocol";
import { PAGE_SOURCE, CONTENT_SOURCE, type ContentToPage } from "../transport.js";
import { createHighlighter } from "./highlighter.js";
import { createInspectController, tryReactTextOverride } from "./inspect.js";

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
const inspect = createInspectController({
  fiber,
  highlighter,
  onPick: (pick) => {
    window.postMessage(
      {
        source: PAGE_SOURCE,
        kind: "inspect-picked",
        componentId: pick.componentId,
        name: pick.name,
        ...(pick.sourceFile ? { sourceFile: pick.sourceFile } : {}),
        ...(pick.sourceLine != null ? { sourceLine: pick.sourceLine } : {}),
      },
      "*",
    );
  },
});

function post(frame: Frame): void {
  window.postMessage({ source: PAGE_SOURCE, kind: "frame", frame }, "*");
}

function start(): void {
  if (instrumentation.isRecording()) return;
  instrumentation.start({
    captureDOM: true,
    interactionWindowMs: 200,
    streamSnapshots: false,
    onFrame: (frame) => post(frame),
  });
  window.postMessage(
    { source: PAGE_SOURCE, kind: "hello", reactVersion: fiber.reactVersion() },
    "*",
  );
}

start();

const SOURCE_MAX_BYTES = 2 * 1024 * 1024;

async function fetchSourceForPanel(requestId: string, url: string): Promise<void> {
  try {
    if (!/^https?:\/\//.test(url) && !url.startsWith("/") && !url.startsWith(".")) {
      throw new Error(`unsupported source url: ${url}`);
    }
    const absolute = new URL(url, location.href).href;
    const res = await fetch(absolute);
    if (!res.ok) throw new Error(`fetch ${absolute}: ${res.status}`);
    const text = await res.text();
    const body = text.length > SOURCE_MAX_BYTES ? text.slice(0, SOURCE_MAX_BYTES) : text;
    window.postMessage(
      {
        source: PAGE_SOURCE,
        kind: "source",
        requestId,
        url: absolute,
        body,
        ...(text.length > SOURCE_MAX_BYTES ? { error: "truncated" } : {}),
      },
      "*",
    );
  } catch (err) {
    window.postMessage(
      {
        source: PAGE_SOURCE,
        kind: "source",
        requestId,
        url,
        error: err instanceof Error ? err.message : String(err),
      },
      "*",
    );
  }
}

function replyEdit(
  requestId: string,
  ok: boolean,
  extra?: { mode?: "react" | "dom"; error?: string },
): void {
  window.postMessage(
    {
      source: PAGE_SOURCE,
      kind: "edit-result",
      requestId,
      ok,
      ...(extra?.mode ? { mode: extra.mode } : {}),
      ...(extra?.error ? { error: extra.error } : {}),
    },
    "*",
  );
}

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
  } else if (data.kind === "source-request") {
    void fetchSourceForPanel(data.requestId, data.url);
  } else if (data.kind === "highlight") {
    if (data.componentId === null) {
      if (waveTimers.length > 0) return;
      highlighter.hide();
    } else {
      const nodes = fiber.domNodesOf(data.componentId);
      if (data.reveal) highlighter.reveal(nodes);
      else highlighter.show(nodes);
    }
  } else if (data.kind === "replay") {
    replayWave(data.componentIds);
  } else if (data.kind === "inspect-start") {
    inspect.start();
  } else if (data.kind === "inspect-stop") {
    inspect.stop();
  } else if (data.kind === "locate-source") {
    // Production builds expose no _debugStack: find where the component
    // function lives in the shipped bundle instead.
    const loc = fiber.locateComponent(data.componentId);
    window.postMessage(
      {
        source: PAGE_SOURCE,
        kind: "locate-source-result",
        requestId: data.requestId,
        componentId: data.componentId,
        ...(loc ? { file: loc.file, line: loc.line, column: loc.column } : {}),
      },
      "*",
    );
  } else if (data.kind === "time-travel-apply") {
    const result = instrumentation.timeTravel.apply(data.entries, data.atT);
    window.postMessage(
      { source: PAGE_SOURCE, kind: "time-travel-result", requestId: data.requestId, ...result },
      "*",
    );
  } else if (data.kind === "time-travel-live") {
    const result = instrumentation.timeTravel.goLive();
    window.postMessage(
      { source: PAGE_SOURCE, kind: "time-travel-result", requestId: data.requestId, ...result },
      "*",
    );
  } else if (data.kind === "edit-setProp") {
    const ok = fiber.setProp(data.componentId, data.path, data.value);
    replyEdit(data.requestId, ok, ok ? { mode: "react" } : { error: "overrideProps failed" });
  } else if (data.kind === "edit-setHookState") {
    const ok = fiber.setHookState(data.componentId, data.hookIndex, data.path, data.value);
    replyEdit(data.requestId, ok, ok ? { mode: "react" } : { error: "overrideHookState failed" });
  } else if (data.kind === "edit-setText") {
    const okReact = tryReactTextOverride(fiber, data.componentId, data.text);
    if (okReact) {
      replyEdit(data.requestId, true, { mode: "react" });
      return;
    }
    // Ephemeral DOM: set text on host nodes.
    const nodes = fiber.domNodesOf(data.componentId);
    const el = nodes.find((n): n is HTMLElement => n instanceof HTMLElement);
    if (!el) {
      replyEdit(data.requestId, false, { error: "no DOM host" });
      return;
    }
    el.textContent = data.text;
    replyEdit(data.requestId, true, { mode: "dom" });
  }
});

let waveTimers: ReturnType<typeof setTimeout>[] = [];
const WAVE_MAX_GROUPS = 300;
const WAVE_MAX_NODES = 400;
const WAVE_MAX_MS = 1600;

function cancelWave(): void {
  for (const t of waveTimers) clearTimeout(t);
  waveTimers = [];
  highlighter.hide();
}

function replayWave(ids: ReadonlyArray<number>): void {
  cancelWave();
  const capped = ids.slice(0, WAVE_MAX_GROUPS);
  const groups = capped
    .map((id) => fiber.domNodesOf(id as ComponentId))
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
