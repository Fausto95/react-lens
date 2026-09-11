export type ReactInternalsPhase = "mount" | "update" | "unmount";

export interface ReactInternalsFiberSnapshot {
  fiberId: number;
  name: string;
  phase: ReactInternalsPhase;
  tag?: string;
  flags?: string[];
  lanes?: string[];
  parentId?: number;
  ownerId?: number;
  source?: { file: string; line?: number; column?: number };
  props?: unknown;
  state?: unknown;
}

export interface ReactInternalsCommit {
  id: number;
  rendererId: number;
  timestamp: number;
  fibers: ReactInternalsFiberSnapshot[];
}

export interface ReactInternalsRuntimeAdapter {
  subscribe(listener: (commit: ReactInternalsCommit) => void): () => void;
}

/**
 * Optional adapter seam for experiments that collect React internals with Bippy.
 *
 * Production React Lens already owns the DevTools hook through @reactlens/fiber,
 * so the shipped panel consumes that normalized trace instead of installing a
 * second hook owner. Keeping this contract means a Bippy-backed collector can be
 * prototyped without leaking raw Fiber objects into React components or storage.
 */
export function createWindowBippyAdapter(target: Window = window): ReactInternalsRuntimeAdapter {
  return {
    subscribe(listener) {
      const onCommit = (event: Event) => {
        const detail = (event as CustomEvent<ReactInternalsCommit>).detail;
        if (!detail || !Array.isArray(detail.fibers)) return;
        listener(detail);
      };

      target.addEventListener("reactlens:bippy-commit", onCommit);
      return () => target.removeEventListener("reactlens:bippy-commit", onCommit);
    },
  };
}

export function publishBippyCommit(commit: ReactInternalsCommit, target: Window = window): void {
  target.dispatchEvent(new CustomEvent<ReactInternalsCommit>("reactlens:bippy-commit", { detail: commit }));
}
