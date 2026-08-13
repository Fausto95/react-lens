export { TraceStore } from "./trace-store.js";
export type {
  TraceStoreConfig,
  TraceSelector,
  Dispose,
  CommitSummary,
  RetentionAccount,
} from "./trace-store.js";
export { RingBuffer } from "./ring-buffer.js";
export { applySetAt, compareApplySets, createApplySetCursor, diffApplySet } from "./time-travel.js";
export type { ApplySetCursor, ApplySetChange, ApplySetComparison } from "./time-travel.js";
export { anomalyStats } from "./anomaly.js";
export type { AnomalyStats } from "./anomaly.js";
export { buildInteractions } from "./interactions.js";
export type { Interaction, InteractionMetrics, InteractionKind } from "./interactions.js";
