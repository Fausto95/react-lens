import { createSerializer } from "@react-lens/serializer";
import { createFiberBridge, type CommitObservation, type Dispose } from "@react-lens/fiber";
import { createInstrumentation, type Instrumentation } from "@react-lens/instrumentation";
import { TraceStore } from "@react-lens/trace-engine";
import { createCausality, type Causality } from "@react-lens/causality";
import type {
  ComponentId,
  ComponentInstance,
  TimeTravelEntry,
  TimeTravelResult,
} from "@react-lens/protocol";

export interface LensRuntime {
  store: TraceStore;
  causality: Causality;
  instrumentation: Instrumentation;
  /** Exclude a DOM subtree (e.g. the panel overlay) from capture. */
  ignoreContainer(node: Node): void;
  /** Live DOM nodes for a component — used for page highlighting (embedded). */
  domNodesOf(id: ComponentId): Node[];
  /** Map a DOM node to its nearest React component (inspect mode). */
  resolveComponent(node: Node): ComponentInstance | null;
  /** Subscribe to commits (for the render overlay). Embedded only. */
  onCommit(cb: (commit: CommitObservation) => void): Dispose;
  /** Whether live value editing is available (dev-build renderer). */
  canEditValues(): boolean;
  setProp(id: ComponentId, path: Array<string | number>, value: unknown): boolean;
  setHookState(
    id: ComponentId,
    hookIndex: number,
    path: Array<string | number>,
    value: unknown,
  ): boolean;
  /** Real time travel: restore captured raw state on the page (dev builds). */
  timeTravel: {
    supported(): boolean;
    apply(entries: TimeTravelEntry[]): TimeTravelResult;
    goLive(): TimeTravelResult;
  };
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
    domNodesOf: (id) => fiber.domNodesOf(id),
    resolveComponent: (node) => fiber.resolveComponent(node),
    onCommit: (cb) => fiber.onCommit(cb),
    canEditValues: () => fiber.canEditValues(),
    setProp: (id, path, value) => fiber.setProp(id, path, value),
    setHookState: (id, hookIndex, path, value) => fiber.setHookState(id, hookIndex, path, value),
    timeTravel: {
      supported: () => instrumentation.timeTravel.supported(),
      apply: (entries) => instrumentation.timeTravel.apply(entries),
      goLive: () => instrumentation.timeTravel.goLive(),
    },
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
