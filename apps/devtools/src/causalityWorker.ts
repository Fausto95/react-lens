/// <reference lib="webworker" />
/**
 * Causality worker: analyzes new renders off the ingest path and returns
 * wasted/expected flags. The trace worker applies flags into the columnar index.
 */
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import type { EventsBatchMessage, RenderId } from "@reactlens/protocol";
import type { CausalityJob, CausalityResult } from "./traceQuery.js";

const store = new TraceStore();
const causality = createCausality(store);

type InMsg =
  | { type: "frame"; batch: EventsBatchMessage["payload"] }
  | { type: "clear" }
  | CausalityJob
  | { type: "why"; requestId: number; renderId: RenderId };

self.addEventListener("message", (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object" || !("type" in msg)) return;

  if (msg.type === "frame") {
    store.ingest(msg.batch);
    return;
  }
  if (msg.type === "clear") {
    store.clear();
    return;
  }
  if (msg.type === "analyze-renders") {
    const wasted: RenderId[] = [];
    const expected: RenderId[] = [];
    for (const id of msg.renderIds) {
      try {
        const v = causality.why(id).verdict;
        if (v === "no-observable-change") wasted.push(id);
        else if (v === "expected") expected.push(id);
      } catch {
        /* missing snapshot */
      }
    }
    const result: CausalityResult = { type: "flags", wasted, expected };
    (self as DedicatedWorkerGlobalScope).postMessage(result);
    return;
  }
  if (msg.type === "why") {
    try {
      const result = causality.why(msg.renderId);
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: "why-result",
        requestId: msg.requestId,
        result,
      });
    } catch (err) {
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: "why-result",
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
});
