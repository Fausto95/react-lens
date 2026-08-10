import { createSerializer } from "@react-lens/serializer";
import { createFiberBridge } from "@react-lens/fiber";
import { createInstrumentation, type Instrumentation } from "@react-lens/instrumentation";
import { TraceStore } from "@react-lens/trace-engine";
import { createCausality, type Causality } from "@react-lens/causality";

export interface LensRuntime {
  store: TraceStore;
  causality: Causality;
  instrumentation: Instrumentation;
  /** Exclude a DOM subtree (e.g. the panel overlay) from capture. */
  ignoreContainer(node: Node): void;
  start(): void;
  stop(): void;
}

/**
 * Embedded runtime: instrumentation and the trace store live in the same page
 * (playground dev mode), so frames flow straight into the store. In the
 * extension, the page-side instrumentation and the panel-side store are wired
 * across the messaging transport instead — same store, same causality engine.
 *
 * Must be started BEFORE the inspected React app first commits, so the owned
 * hook is installed before react-dom registers its renderer.
 */
export function createEmbeddedRuntime(): LensRuntime {
  const store = new TraceStore();
  const causality = createCausality(store);
  const serializer = createSerializer();
  const fiber = createFiberBridge(globalThis);
  const instrumentation = createInstrumentation({ fiber, serializer });

  return {
    store,
    causality,
    instrumentation,
    ignoreContainer: (node) => fiber.ignoreContainer(node),
    start() {
      instrumentation.start({
        captureDOM: true,
        interactionWindowMs: 200,
        onFrame: (frame) => store.ingest(frame),
      });
    },
    stop() {
      instrumentation.stop();
    },
  };
}
