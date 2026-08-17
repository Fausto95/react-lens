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
export type {
  Interaction,
  InteractionMetrics,
  InteractionKind,
  SystemTrigger,
} from "./interactions.js";
export { interactionKindLabel } from "./interactions.js";

export {
  TimelineIndex,
  CauseCode,
  RenderFlags,
  LOD_BUCKET_MS,
  lowerBound,
  upperBound,
  causeFromReasons,
} from "./columnar.js";
export type {
  AppendRenderInput,
  LaneColumns,
  LodBucket,
  LodLevel,
  CauseCodeValue,
  RenderFlag,
} from "./columnar.js";

export {
  queryTimeline,
  statsPairInRange,
  statsInRange,
  hitTest,
  activityIntervals,
  causeCodeToName,
} from "./aggregates.js";
export type {
  TimelineQuery,
  TimelineQueryResult,
  TimelineRowMeta,
  TimelineColumns,
  TimelineBucketColumns,
  RegionStats,
  RegionStatsPair,
  HitTestResult,
  HitTestOptions,
} from "./aggregates.js";

export { FlatTreeIndex, TreeFlags } from "./flat-tree.js";
export type { FlatTreeNodeInput, FlatTreeColumns, VisibleTreeRow } from "./flat-tree.js";

export {
  RetentionManager,
  createMemoryColdStore,
  sliceToChunk,
  DEFAULT_RETENTION,
} from "./retention.js";
export type { RetentionTier, ColumnarChunk, RetentionConfig, ColdStore } from "./retention.js";
