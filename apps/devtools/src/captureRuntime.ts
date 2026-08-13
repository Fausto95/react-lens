import type { EventsBatchMessage } from "@reactlens/protocol";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality, type Causality } from "@reactlens/causality";
import { createSerializer } from "@reactlens/serializer";
import { createFiberBridge, type FiberBridge } from "@reactlens/fiber";
import { createInstrumentation, type Instrumentation } from "@reactlens/instrumentation";

/** Headless capture runtime — store + causality + instrumentation without panel DOM helpers. */
export interface CaptureRuntime {
  store: TraceStore;
  causality: Causality;
  instrumentation: Instrumentation;
  fiber: FiberBridge;
  start(): void;
  stop(): void;
}

export function createCaptureRuntime(): CaptureRuntime {
  const store = new TraceStore();
  const causality = createCausality(store);
  const serializer = createSerializer();
  const fiber = createFiberBridge(globalThis);
  const instrumentation = createInstrumentation({ fiber, serializer });

  return {
    store,
    causality,
    instrumentation,
    fiber,
    start() {
      instrumentation.start({
        captureDOM: true,
        interactionWindowMs: 200,
        onFrame: (frame: EventsBatchMessage["payload"]) => store.ingest(frame),
      });
      if (typeof globalThis !== "undefined") {
        const g = globalThis as typeof globalThis & {
          __REACT_LENS__?: { markInteraction?: (name: string, untilMs?: number) => void };
        };
        g.__REACT_LENS__ = {
          markInteraction: (name, untilMs) => instrumentation.markInteraction(name, untilMs),
        };
      }
    },
    stop() {
      instrumentation.stop();
    },
  };
}
