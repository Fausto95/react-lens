/**
 * Trace-side Jotai atoms. ExtensionPanel mounts {@link TraceProvider} which
 * binds {@link bindTraceVersion}; Panel still reads the sync cache via props
 * during migration. Async atoms cover worker-authoritative queries.
 */
import { atom } from "jotai";
import type { TraceSelector } from "@reactlens/trace-engine";
import type { Cause } from "@reactlens/causality";
import type { RenderId } from "@reactlens/protocol";
import type { TraceClient, TraceSessionExport, TraceWorkerStats } from "../traceClient.js";
import { selectedIdAtom, cursorAtom } from "./ui.js";

export { selectedIdAtom, cursorAtom };

export const traceClientAtom = atom<TraceClient | null>(null);

const traceVersionBaseAtom = atom(0);

/**
 * Monotonic version bumped on every relevant ingest. Write with `bump` to
 * signal a change; read from components that opt into the atom bridge.
 */
export const traceVersionAtom = atom(
  (get) => get(traceVersionBaseAtom),
  (_get, set) => set(traceVersionBaseAtom, (v) => v + 1),
);

/**
 * Subscribe a TraceClient (or its cache store) to bump {@link traceVersionAtom}.
 * Call from a Provider / mount effect once the client exists.
 */
export function bindTraceVersion(
  client: Pick<TraceClient, "subscribe">,
  bump: () => void,
  selector: TraceSelector = { kind: "global" },
): () => void {
  return client.subscribe(selector, bump);
}

/** Worker-authoritative stats; falls back through TraceClient. */
export const traceStatsAtom = atom(async (get): Promise<TraceWorkerStats | null> => {
  get(traceVersionAtom);
  const client = get(traceClientAtom);
  if (!client) return null;
  return client.stats();
});

/** Session export from the worker (or local cache fallback). */
export const exportSessionAtom = atom(async (get): Promise<TraceSessionExport | null> => {
  get(traceVersionAtom);
  const client = get(traceClientAtom);
  if (!client) return null;
  return client.exportSession({
    pageUrl: typeof location !== "undefined" ? location.href : undefined,
  });
});

/**
 * Write the render id to query; read {@link causesAtom} for the result.
 * Agent tools can stay on the main-thread causality for now — this is the thin
 * Comlink wrapper path.
 */
export const causesRenderIdAtom = atom<RenderId | null>(null);

export const causesAtom = atom(async (get): Promise<Cause[] | null> => {
  get(traceVersionAtom);
  const client = get(traceClientAtom);
  const renderId = get(causesRenderIdAtom);
  if (!client || renderId == null) return null;
  return client.getCauses(renderId);
});
