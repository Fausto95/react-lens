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

/** How the worker is created — injectable so the lifecycle is testable. */
export type DoctorSpawn = () => Worker;

const spawnDoctorWorker: DoctorSpawn = () =>
  new Worker(new URL("./doctorWorker.ts", import.meta.url), { type: "module" });

/**
 * Spawns the Doctor worker and adapts it to a small push interface. Returns null
 * if the worker can't be created, and calls `onError` if it dies later —
 * `new Worker` resolves its script asynchronously, so a construction that
 * succeeds is no promise that the worker runs. Callers fall back to the
 * synchronous pass in both cases, because a Doctor that silently counts zero is
 * indistinguishable from a healthy app.
 *
 * The client owns its worker: `dispose()` terminates it and leaves this object
 * inert, so a disposed client can never look alive.
 *
 * Frames arrive via the panel store's `onIngest` tee (including the TraceClient
 * local cache). Keep Doctor on that path so it stays in lockstep with whatever
 * the panel is reading — no separate ingest wiring required.
 */
export function createDoctorClient(
  options: { spawn?: DoctorSpawn; onError?: (err: unknown) => void } = {},
): DoctorClient | null {
  let worker: Worker;
  try {
    worker = (options.spawn ?? spawnDoctorWorker)();
  } catch (err) {
    options.onError?.(err);
    return null;
  }

  const subscribers = new Set<(result: DoctorResult) => void>();
  let disposed = false;

  worker.onmessage = (
    e: MessageEvent<{
      type?: string;
      count?: number;
      affected?: ComponentId[];
      diagnostics?: Diagnostic[];
      fused?: Diagnostic[];
    }>,
  ) => {
    if (disposed) return;
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

  worker.onerror = (err) => {
    if (disposed) return;
    options.onError?.(err);
  };

  const post = (msg: unknown) => {
    if (disposed) return;
    worker.postMessage(msg);
  };

  return {
    ingest: (batch) => post({ type: "frame", batch }),
    analyzeSource: (args) => post({ type: "source", ...args }),
    clearSources: () => post({ type: "clear-sources" }),
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    dispose: () => {
      disposed = true;
      subscribers.clear();
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    },
  };
}
