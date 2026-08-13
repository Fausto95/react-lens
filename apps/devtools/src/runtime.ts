import type { CommitObservation, Dispose } from "@reactlens/fiber";
import type { Instrumentation, TimeTravelStoreAdapter } from "@reactlens/instrumentation";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type {
  ComponentId,
  ComponentInstance,
  TimeTravelEntry,
  TimeTravelResult,
  SourceLocation,
} from "@reactlens/protocol";
import { createCaptureRuntime } from "./captureRuntime.js";

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
  /**
   * Where a component is defined inside the shipped bundle — the source signal
   * that survives a production build (no dev-only fiber fields involved).
   */
  locateComponent(id: ComponentId): SourceLocation | undefined;
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
    apply(entries: TimeTravelEntry[], atT?: number): TimeTravelResult;
    goLive(): TimeTravelResult;
    /** Opt-in external-store rewind (Zustand/Redux/module state). */
    registerStore(adapter: TimeTravelStoreAdapter): () => void;
  };
  start(): void;
  stop(): void;
}

export { createCaptureRuntime, type CaptureRuntime } from "./captureRuntime.js";

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
  const capture = createCaptureRuntime();
  const { fiber } = capture;

  return {
    store: capture.store,
    causality: capture.causality,
    instrumentation: capture.instrumentation,
    ignoreContainer: (node) => fiber.ignoreContainer(node),
    domNodesOf: (id) => fiber.domNodesOf(id),
    resolveComponent: (node) => fiber.resolveComponent(node),
    onCommit: (cb) => fiber.onCommit(cb),
    canEditValues: () => fiber.canEditValues(),
    locateComponent: (id) => fiber.locateComponent(id),
    setProp: (id, path, value) => fiber.setProp(id, path, value),
    setHookState: (id, hookIndex, path, value) => fiber.setHookState(id, hookIndex, path, value),
    timeTravel: {
      supported: () => capture.instrumentation.timeTravel.supported(),
      apply: (entries, atT) => capture.instrumentation.timeTravel.apply(entries, atT),
      goLive: () => capture.instrumentation.timeTravel.goLive(),
      registerStore: (adapter) => capture.instrumentation.timeTravel.registerStore(adapter),
    },
    start: () => capture.start(),
    stop: () => capture.stop(),
  };
}
