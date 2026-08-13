import type { EventsBatchMessage, ComponentId } from "@reactlens/protocol";
import type { Diagnostic } from "@reactlens/diagnostics";

export interface DoctorResult {
  count: number;
  affected: Set<ComponentId>;
  diagnostics: Diagnostic[];
  fused?: Diagnostic[];
}

export interface DoctorClient {
  ingest(batch: EventsBatchMessage["payload"]): void;
  /** Upload original source for static+runtime fusion in the worker. */
  analyzeSource(args: {
    componentId: ComponentId;
    name: string;
    sourceText: string;
    file?: string;
  }): void;
  clearSources(): void;
  subscribe(cb: (result: DoctorResult) => void): () => void;
  dispose(): void;
}

/**
 * Spawns the Doctor worker and adapts it to a small push interface. Returns null
 * if the worker can't be created (bundling/runtime); callers fall back to the
 * synchronous pass, so Doctor degrades gracefully rather than breaking.
 *
 * Frames still arrive via the panel store's `onIngest` tee (including the
 * TraceClient local cache). Keep Doctor on that path so it stays in lockstep
 * with whatever the panel is reading — no separate ingest wiring required.
 */
export function createDoctorClient(): DoctorClient | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./doctorWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  const subscribers = new Set<(result: DoctorResult) => void>();
  worker.onmessage = (
    e: MessageEvent<{
      type?: string;
      count?: number;
      affected?: ComponentId[];
      diagnostics?: Diagnostic[];
      fused?: Diagnostic[];
    }>,
  ) => {
    // Source-map resolve replies are request/response; ignore them here.
    if (e.data?.type === "resolve-result") return;
    if (typeof e.data?.count !== "number" || !e.data.affected) return;
    const result: DoctorResult = {
      count: e.data.count,
      affected: new Set(e.data.affected),
      diagnostics: e.data.diagnostics ?? [],
      ...(e.data.fused ? { fused: e.data.fused } : {}),
    };
    for (const cb of subscribers) cb(result);
  };

  return {
    ingest: (batch) => worker.postMessage({ type: "frame", batch }),
    analyzeSource: (args) => worker.postMessage({ type: "source", ...args }),
    clearSources: () => worker.postMessage({ type: "clear-sources" }),
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    dispose: () => {
      subscribers.clear();
      worker.terminate();
    },
  };
}
