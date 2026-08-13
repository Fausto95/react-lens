/**
 * Public trace-worker + Jotai bridge entry for the extension panel.
 */
export {
  createTraceClient,
  bindTraceVersion,
  traceClientAtom,
  traceVersionAtom,
} from "./traceClient.js";
export type {
  TraceClient,
  TraceClientHandle,
  TraceClientOptions,
  TraceClientWalHandlers,
  TraceIngestMeta,
  TraceWorkerApi,
  TraceWorkerStats,
  TraceSessionExport,
  TraceSegment,
} from "./traceClient.js";
export { TraceProvider } from "./TraceProvider.js";
