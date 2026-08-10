/// <reference lib="webworker" />
import { TraceStore } from "@react-lens/trace-engine";
import { createCausality } from "@react-lens/causality";
import type { EventsBatchMessage, ComponentId } from "@react-lens/protocol";
import { diagnoseAll } from "./doctor.js";

/**
 * Doctor worker: mirrors the panel's trace store and runs the all-components
 * diagnostic pass off the main thread. It holds its own pure TraceStore +
 * causality (no DOM/React), ingests the same batches the panel does, and posts
 * back a compact result — an issue count and the affected component ids for the
 * tree badges. Recompute is debounced so a burst of frames costs one pass.
 */
type FrameMessage = { type: "frame"; batch: EventsBatchMessage["payload"] };
type DoctorResultMessage = { count: number; affected: ComponentId[] };

const store = new TraceStore();
const causality = createCausality(store);
let timer: ReturnType<typeof setTimeout> | undefined;

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<FrameMessage>) => void) | null;
  postMessage: (msg: DoctorResultMessage) => void;
};

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg?.type === "frame") {
    store.ingest(msg.batch);
    schedule();
  }
};

function schedule(): void {
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    const { diagnostics, affected } = diagnoseAll(store, causality);
    ctx.postMessage({ count: diagnostics.length, affected: [...affected] });
  }, 200);
}
