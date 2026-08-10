import type { EventsBatchMessage, ComponentId } from "@react-lens/protocol";

export interface DoctorResult {
  count: number;
  affected: Set<ComponentId>;
}

export interface DoctorClient {
  ingest(batch: EventsBatchMessage["payload"]): void;
  subscribe(cb: (result: DoctorResult) => void): () => void;
  dispose(): void;
}

/**
 * Spawns the Doctor worker and adapts it to a small push interface. Returns null
 * if the worker can't be created (bundling/runtime); callers fall back to the
 * synchronous pass, so Doctor degrades gracefully rather than breaking.
 */
export function createDoctorClient(): DoctorClient | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./doctorWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  const subscribers = new Set<(result: DoctorResult) => void>();
  worker.onmessage = (e: MessageEvent<{ count: number; affected: ComponentId[] }>) => {
    const result: DoctorResult = { count: e.data.count, affected: new Set(e.data.affected) };
    for (const cb of subscribers) cb(result);
  };

  return {
    ingest: (batch) => worker.postMessage({ type: "frame", batch }),
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
