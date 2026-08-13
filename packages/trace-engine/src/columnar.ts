/**
 * Columnar timeline index: typed arrays per lane, binary-searchable by time,
 * with prefix sums and LOD aggregation pyramids.
 *
 * Interactive work must scale with the viewport, not the session.
 */

export const RenderFlags = {
  None: 0,
  Wasted: 1 << 0,
} as const;

export type RenderFlag = number;

/** Cause encoding matching timeline ClipCause. */
export const CauseCode = {
  props: 0,
  state: 1,
  context: 2,
  cascade: 3,
  mount: 4,
  other: 5,
} as const;

export type CauseCodeValue = (typeof CauseCode)[keyof typeof CauseCode];

export const LOD_BUCKET_MS = [1, 4, 16, 64, 256, 1000] as const;
export type LodLevel = 0 | 1 | 2 | 3 | 4 | 5;

const INITIAL_CAP = 64;

function growFloat64(
  arr: Float64Array<ArrayBufferLike>,
  need: number,
): Float64Array<ArrayBufferLike> {
  if (need <= arr.length) return arr;
  let n = arr.length || INITIAL_CAP;
  while (n < need) n *= 2;
  const next = new Float64Array(n);
  next.set(arr);
  return next;
}

function growFloat32(
  arr: Float32Array<ArrayBufferLike>,
  need: number,
): Float32Array<ArrayBufferLike> {
  if (need <= arr.length) return arr;
  let n = arr.length || INITIAL_CAP;
  while (n < need) n *= 2;
  const next = new Float32Array(n);
  next.set(arr);
  return next;
}

function growUint32(arr: Uint32Array<ArrayBufferLike>, need: number): Uint32Array<ArrayBufferLike> {
  if (need <= arr.length) return arr;
  let n = arr.length || INITIAL_CAP;
  while (n < need) n *= 2;
  const next = new Uint32Array(n);
  next.set(arr);
  return next;
}

function growUint8(arr: Uint8Array<ArrayBufferLike>, need: number): Uint8Array<ArrayBufferLike> {
  if (need <= arr.length) return arr;
  let n = arr.length || INITIAL_CAP;
  while (n < need) n *= 2;
  const next = new Uint8Array(n);
  next.set(arr);
  return next;
}

function growInt32(arr: Int32Array<ArrayBufferLike>, need: number): Int32Array<ArrayBufferLike> {
  if (need <= arr.length) return arr;
  let n = arr.length || INITIAL_CAP;
  while (n < need) n *= 2;
  const next = new Int32Array(n);
  next.set(arr);
  return next;
}

/** First index with timestamps[i] >= target. */
export function lowerBound(timestamps: ArrayLike<number>, count: number, target: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (timestamps[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with timestamps[i] > target. */
export function upperBound(timestamps: ArrayLike<number>, count: number, target: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (timestamps[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface LodBucket {
  start: number;
  renderCount: number;
  wastedCount: number;
  totalTime: number;
  selfTime: number;
  maxDuration: number;
  propsCount: number;
  stateCount: number;
  contextCount: number;
}

interface LodLevelState {
  bucketMs: number;
  /** Sparse map: bucketStart → bucket (mutated on append). */
  buckets: Map<number, LodBucket>;
  /** Bucket starts for O(log B + visible B) viewport reads. */
  starts: number[];
  startsSorted: boolean;
}

export interface AppendRenderInput {
  timestamp: number;
  duration: number;
  selfDuration: number;
  renderId: number;
  componentId: number;
  commitId: number;
  cause: CauseCodeValue;
  flags?: RenderFlag;
  /** Component display name for the lane. */
  name: string;
  laneKey: string;
}

export interface LaneColumns {
  laneKey: string;
  name: string;
  count: number;
  timestamps: Float64Array<ArrayBufferLike>;
  durations: Float32Array<ArrayBufferLike>;
  selfDurations: Float32Array<ArrayBufferLike>;
  renderIds: Uint32Array<ArrayBufferLike>;
  componentIds: Uint32Array<ArrayBufferLike>;
  commitIds: Uint32Array<ArrayBufferLike>;
  causes: Uint8Array<ArrayBufferLike>;
  flags: Uint8Array<ArrayBufferLike>;
  /** Stack row assigned incrementally on append. */
  rows: Uint16Array<ArrayBufferLike>;
  /** Prefix sums: prefix[i] = sum of [0..i). Length = count+1. */
  selfPrefix: Float64Array<ArrayBufferLike>;
  countPrefix: Uint32Array<ArrayBufferLike>;
  wastedPrefix: Uint32Array<ArrayBufferLike>;
  wastedSelfPrefix: Float64Array<ArrayBufferLike>;
  /** Live row-end times for incremental stack assignment. */
  rowEnds: number[];
  maxRow: number;
  instanceIds: Set<number>;
  firstT: number;
  selfTotal: number;
  totalDuration: number;
  wastedCount: number;
  lod: LodLevelState[];
}

function emptyLane(laneKey: string, name: string): LaneColumns {
  return {
    laneKey,
    name,
    count: 0,
    timestamps: new Float64Array(INITIAL_CAP),
    durations: new Float32Array(INITIAL_CAP),
    selfDurations: new Float32Array(INITIAL_CAP),
    renderIds: new Uint32Array(INITIAL_CAP),
    componentIds: new Uint32Array(INITIAL_CAP),
    commitIds: new Uint32Array(INITIAL_CAP),
    causes: new Uint8Array(INITIAL_CAP),
    flags: new Uint8Array(INITIAL_CAP),
    rows: new Uint16Array(INITIAL_CAP),
    selfPrefix: new Float64Array(INITIAL_CAP + 1),
    countPrefix: new Uint32Array(INITIAL_CAP + 1),
    wastedPrefix: new Uint32Array(INITIAL_CAP + 1),
    wastedSelfPrefix: new Float64Array(INITIAL_CAP + 1),
    rowEnds: [],
    maxRow: 0,
    instanceIds: new Set(),
    firstT: Number.POSITIVE_INFINITY,
    selfTotal: 0,
    totalDuration: 0,
    wastedCount: 0,
    lod: LOD_BUCKET_MS.map((bucketMs) => ({
      bucketMs,
      buckets: new Map(),
      starts: [],
      startsSorted: true,
    })),
  };
}

function ensureCapacity(lane: LaneColumns, need: number): void {
  lane.timestamps = growFloat64(lane.timestamps, need);
  lane.durations = growFloat32(lane.durations, need);
  lane.selfDurations = growFloat32(lane.selfDurations, need);
  lane.renderIds = growUint32(lane.renderIds, need);
  lane.componentIds = growUint32(lane.componentIds, need);
  lane.commitIds = growUint32(lane.commitIds, need);
  lane.causes = growUint8(lane.causes, need);
  lane.flags = growUint8(lane.flags, need);
  if (need > lane.rows.length) {
    let n = lane.rows.length || INITIAL_CAP;
    while (n < need) n *= 2;
    const next = new Uint16Array(n);
    next.set(lane.rows);
    lane.rows = next;
  }
  const prefixNeed = need + 1;
  lane.selfPrefix = growFloat64(lane.selfPrefix, prefixNeed);
  lane.countPrefix = growUint32(lane.countPrefix, prefixNeed);
  lane.wastedPrefix = growUint32(lane.wastedPrefix, prefixNeed);
  lane.wastedSelfPrefix = growFloat64(lane.wastedSelfPrefix, prefixNeed);
}

function assignStackRow(lane: LaneColumns, t0: number, t1: number): number {
  const ends = lane.rowEnds;
  let r = ends.findIndex((e) => e <= t0 + 0.01);
  if (r === -1) {
    r = ends.length;
    ends.push(t1);
  } else {
    ends[r] = t1;
  }
  lane.maxRow = Math.max(lane.maxRow, r);
  return r;
}

function updateLod(lane: LaneColumns, input: AppendRenderInput, wasted: boolean): void {
  for (const level of lane.lod) {
    const start = Math.floor(input.timestamp / level.bucketMs) * level.bucketMs;
    let b = level.buckets.get(start);
    if (!b) {
      b = {
        start,
        renderCount: 0,
        wastedCount: 0,
        totalTime: 0,
        selfTime: 0,
        maxDuration: 0,
        propsCount: 0,
        stateCount: 0,
        contextCount: 0,
      };
      level.buckets.set(start, b);
      const last = level.starts[level.starts.length - 1];
      if (last !== undefined && start < last) level.startsSorted = false;
      level.starts.push(start);
    }
    b.renderCount++;
    if (wasted) b.wastedCount++;
    b.totalTime += input.duration;
    b.selfTime += input.selfDuration;
    b.maxDuration = Math.max(b.maxDuration, input.duration);
    if (input.cause === CauseCode.props) b.propsCount++;
    else if (input.cause === CauseCode.state || input.cause === CauseCode.mount) b.stateCount++;
    else if (input.cause === CauseCode.context) b.contextCount++;
  }
}

/**
 * Global + per-lane columnar index. Append-only (clear resets). Events are
 * expected roughly chronological; out-of-order timestamps still work for
 * prefix sums but binary search assumes sorted lanes — callers should append
 * in time order (capture does).
 */
export class TimelineIndex {
  readonly lanes = new Map<string, LaneColumns>();
  /** Global chronological columns (all lanes interleaved by arrival). */
  count = 0;
  timestamps: Float64Array<ArrayBufferLike> = new Float64Array(INITIAL_CAP);
  durations: Float32Array<ArrayBufferLike> = new Float32Array(INITIAL_CAP);
  selfDurations: Float32Array<ArrayBufferLike> = new Float32Array(INITIAL_CAP);
  renderIds: Uint32Array<ArrayBufferLike> = new Uint32Array(INITIAL_CAP);
  componentIds: Uint32Array<ArrayBufferLike> = new Uint32Array(INITIAL_CAP);
  commitIds: Uint32Array<ArrayBufferLike> = new Uint32Array(INITIAL_CAP);
  causes: Uint8Array<ArrayBufferLike> = new Uint8Array(INITIAL_CAP);
  flags: Uint8Array<ArrayBufferLike> = new Uint8Array(INITIAL_CAP);
  /** Global prefix sums: prefix[i] = sum of [0..i). Length = count+1. */
  selfPrefix: Float64Array<ArrayBufferLike> = new Float64Array(INITIAL_CAP + 1);
  countPrefix: Uint32Array<ArrayBufferLike> = new Uint32Array(INITIAL_CAP + 1);
  wastedPrefix: Uint32Array<ArrayBufferLike> = new Uint32Array(INITIAL_CAP + 1);
  wastedSelfPrefix: Float64Array<ArrayBufferLike> = new Float64Array(INITIAL_CAP + 1);
  /** Lane key string index into laneOrder. */
  laneIndices: Int32Array<ArrayBufferLike> = new Int32Array(INITIAL_CAP);
  laneOrder: string[] = [];
  private laneKeyToOrder = new Map<string, number>();
  /** renderId → global column index for O(1) flag updates. */
  private renderToIndex = new Map<number, number>();
  /** renderId → { laneKey, localIndex }. */
  private renderToLane = new Map<number, { laneKey: string; index: number }>();
  private orderedCache: LaneColumns[] | null = null;
  private orderedNonQuietCache: { quietTotalMs: number; lanes: LaneColumns[] } | null = null;
  private quietSummaryCache: {
    quietTotalMs: number;
    lanes: number;
    renders: number;
    selfMs: number;
  } | null = null;

  t0 = Number.POSITIVE_INFINITY;
  t1 = Number.NEGATIVE_INFINITY;

  append(input: AppendRenderInput): void {
    if (this.renderToIndex.has(input.renderId)) return;

    const flags = input.flags ?? RenderFlags.None;
    const wasted = (flags & RenderFlags.Wasted) !== 0;

    // Global columns
    const g = this.count;
    const gNeed = g + 1;
    this.timestamps = growFloat64(this.timestamps, gNeed);
    this.durations = growFloat32(this.durations, gNeed);
    this.selfDurations = growFloat32(this.selfDurations, gNeed);
    this.renderIds = growUint32(this.renderIds, gNeed);
    this.componentIds = growUint32(this.componentIds, gNeed);
    this.commitIds = growUint32(this.commitIds, gNeed);
    this.causes = growUint8(this.causes, gNeed);
    this.flags = growUint8(this.flags, gNeed);
    this.laneIndices = growInt32(this.laneIndices, gNeed);
    const prefixNeed = gNeed + 1;
    this.selfPrefix = growFloat64(this.selfPrefix, prefixNeed);
    this.countPrefix = growUint32(this.countPrefix, prefixNeed);
    this.wastedPrefix = growUint32(this.wastedPrefix, prefixNeed);
    this.wastedSelfPrefix = growFloat64(this.wastedSelfPrefix, prefixNeed);

    this.timestamps[g] = input.timestamp;
    this.durations[g] = input.duration;
    this.selfDurations[g] = input.selfDuration;
    this.renderIds[g] = input.renderId;
    this.componentIds[g] = input.componentId;
    this.commitIds[g] = input.commitId;
    this.causes[g] = input.cause;
    this.flags[g] = flags;
    this.selfPrefix[g + 1] = this.selfPrefix[g]! + input.selfDuration;
    this.countPrefix[g + 1] = this.countPrefix[g]! + 1;
    this.wastedPrefix[g + 1] = this.wastedPrefix[g]! + (wasted ? 1 : 0);
    this.wastedSelfPrefix[g + 1] = this.wastedSelfPrefix[g]! + (wasted ? input.selfDuration : 0);

    let laneOrd = this.laneKeyToOrder.get(input.laneKey);
    if (laneOrd === undefined) {
      laneOrd = this.laneOrder.length;
      this.laneOrder.push(input.laneKey);
      this.laneKeyToOrder.set(input.laneKey, laneOrd);
      this.orderedCache = null;
    }
    this.laneIndices[g] = laneOrd;
    this.renderToIndex.set(input.renderId, g);
    this.count = gNeed;

    // Per-lane columns
    let lane = this.lanes.get(input.laneKey);
    let previousTotalDuration = 0;
    if (!lane) {
      lane = emptyLane(input.laneKey, input.name);
      this.lanes.set(input.laneKey, lane);
      this.orderedCache = null;
      this.orderedNonQuietCache = null;
      this.quietSummaryCache = null;
    } else {
      previousTotalDuration = lane.totalDuration;
    }
    const i = lane.count;
    ensureCapacity(lane, i + 1);
    const t1 = input.timestamp + input.duration;
    const row = assignStackRow(lane, input.timestamp, t1);

    lane.timestamps[i] = input.timestamp;
    lane.durations[i] = input.duration;
    lane.selfDurations[i] = input.selfDuration;
    lane.renderIds[i] = input.renderId;
    lane.componentIds[i] = input.componentId;
    lane.commitIds[i] = input.commitId;
    lane.causes[i] = input.cause;
    lane.flags[i] = flags;
    lane.rows[i] = row;

    lane.selfPrefix[i + 1] = lane.selfPrefix[i]! + input.selfDuration;
    lane.countPrefix[i + 1] = lane.countPrefix[i]! + 1;
    lane.wastedPrefix[i + 1] = lane.wastedPrefix[i]! + (wasted ? 1 : 0);
    lane.wastedSelfPrefix[i + 1] = lane.wastedSelfPrefix[i]! + (wasted ? input.selfDuration : 0);

    lane.instanceIds.add(input.componentId);
    lane.firstT = Math.min(lane.firstT, input.timestamp);
    lane.selfTotal += input.selfDuration;
    lane.totalDuration += input.duration;
    if (wasted) lane.wastedCount++;
    lane.count = i + 1;
    if (
      this.orderedNonQuietCache &&
      previousTotalDuration < this.orderedNonQuietCache.quietTotalMs &&
      lane.totalDuration >= this.orderedNonQuietCache.quietTotalMs
    ) {
      this.orderedNonQuietCache = null;
    }
    if (this.quietSummaryCache) {
      const threshold = this.quietSummaryCache.quietTotalMs;
      if (previousTotalDuration < threshold || lane.totalDuration < threshold) {
        this.quietSummaryCache = null;
      }
    }

    this.renderToLane.set(input.renderId, { laneKey: input.laneKey, index: i });
    updateLod(lane, input, wasted);

    this.t0 = Math.min(this.t0, input.timestamp);
    this.t1 = Math.max(this.t1, t1);
  }

  /** Set or clear the wasted flag after causality analysis. */
  setFlag(renderId: number, flag: RenderFlag, on: boolean): void {
    const g = this.renderToIndex.get(renderId);
    if (g === undefined) return;
    const prev = this.flags[g]!;
    const next = on ? prev | flag : prev & ~flag;
    if (next === prev) return;
    this.flags[g] = next;
    if (flag === RenderFlags.Wasted) {
      for (let j = g; j < this.count; j++) {
        const w = (this.flags[j]! & RenderFlags.Wasted) !== 0 ? 1 : 0;
        this.wastedPrefix[j + 1] = this.wastedPrefix[j]! + w;
        this.wastedSelfPrefix[j + 1] = this.wastedSelfPrefix[j]! + (w ? this.selfDurations[j]! : 0);
      }
    }

    const loc = this.renderToLane.get(renderId);
    if (!loc) return;
    const lane = this.lanes.get(loc.laneKey);
    if (!lane) return;
    const i = loc.index;
    const wasWasted = (lane.flags[i]! & RenderFlags.Wasted) !== 0;
    lane.flags[i] = next;
    const isWasted = (next & RenderFlags.Wasted) !== 0;
    if (wasWasted === isWasted || flag !== RenderFlags.Wasted) return;

    // Rebuild wasted prefix from i onward (rare: analysis completes async).
    if (isWasted) lane.wastedCount++;
    else lane.wastedCount = Math.max(0, lane.wastedCount - 1);
    for (let j = i; j < lane.count; j++) {
      const w = (lane.flags[j]! & RenderFlags.Wasted) !== 0 ? 1 : 0;
      lane.wastedPrefix[j + 1] = lane.wastedPrefix[j]! + w;
      lane.wastedSelfPrefix[j + 1] = lane.wastedSelfPrefix[j]! + (w ? lane.selfDurations[j]! : 0);
    }
    // Update LOD wasted counts for the bucket containing this render.
    const t = lane.timestamps[i]!;
    for (const level of lane.lod) {
      const start = Math.floor(t / level.bucketMs) * level.bucketMs;
      const b = level.buckets.get(start);
      if (!b) continue;
      if (isWasted) b.wastedCount++;
      else b.wastedCount = Math.max(0, b.wastedCount - 1);
    }
  }

  bounds(): { t0: number; t1: number } {
    if (!Number.isFinite(this.t0) || !Number.isFinite(this.t1)) {
      return { t0: 0, t1: 120 };
    }
    return { t0: this.t0, t1: Math.max(this.t1, this.t0 + 120) };
  }

  clear(): void {
    this.lanes.clear();
    this.count = 0;
    this.timestamps = new Float64Array(INITIAL_CAP);
    this.durations = new Float32Array(INITIAL_CAP);
    this.selfDurations = new Float32Array(INITIAL_CAP);
    this.renderIds = new Uint32Array(INITIAL_CAP);
    this.componentIds = new Uint32Array(INITIAL_CAP);
    this.commitIds = new Uint32Array(INITIAL_CAP);
    this.causes = new Uint8Array(INITIAL_CAP);
    this.flags = new Uint8Array(INITIAL_CAP);
    this.selfPrefix = new Float64Array(INITIAL_CAP + 1);
    this.countPrefix = new Uint32Array(INITIAL_CAP + 1);
    this.wastedPrefix = new Uint32Array(INITIAL_CAP + 1);
    this.wastedSelfPrefix = new Float64Array(INITIAL_CAP + 1);
    this.laneIndices = new Int32Array(INITIAL_CAP);
    this.laneOrder = [];
    this.laneKeyToOrder.clear();
    this.renderToIndex.clear();
    this.renderToLane.clear();
    this.orderedCache = null;
    this.orderedNonQuietCache = null;
    this.quietSummaryCache = null;
    this.t0 = Number.POSITIVE_INFINITY;
    this.t1 = Number.NEGATIVE_INFINITY;
  }

  /** Ordered lanes by firstT then name (stable for UI). */
  orderedLanes(options: { includeQuiet?: boolean; quietTotalMs?: number } = {}): LaneColumns[] {
    if (!this.orderedCache) {
      this.orderedCache = [...this.lanes.values()].sort(
        (a, b) => a.firstT - b.firstT || a.name.localeCompare(b.name),
      );
    }
    if (options.includeQuiet !== false) return this.orderedCache;

    const quietTotalMs = options.quietTotalMs ?? 8;
    if (!this.orderedNonQuietCache || this.orderedNonQuietCache.quietTotalMs !== quietTotalMs) {
      this.orderedNonQuietCache = {
        quietTotalMs,
        lanes: this.orderedCache.filter((lane) => lane.totalDuration >= quietTotalMs),
      };
    }
    return this.orderedNonQuietCache.lanes;
  }

  quietSummary(quietTotalMs = 8): { lanes: number; renders: number; selfMs: number } {
    if (!this.quietSummaryCache || this.quietSummaryCache.quietTotalMs !== quietTotalMs) {
      let lanes = 0;
      let renders = 0;
      let selfMs = 0;
      for (const lane of this.lanes.values()) {
        if (lane.totalDuration >= quietTotalMs) continue;
        lanes++;
        renders += lane.count;
        selfMs += lane.selfTotal;
      }
      this.quietSummaryCache = { quietTotalMs, lanes, renders, selfMs };
    }
    const { lanes, renders, selfMs } = this.quietSummaryCache;
    return { lanes, renders, selfMs };
  }
}

export function causeFromReasons(reasons: ReadonlyArray<{ type: string }>): CauseCodeValue {
  const reason = reasons[0];
  if (!reason) return CauseCode.other;
  switch (reason.type) {
    case "props":
      return CauseCode.props;
    case "state":
      return CauseCode.state;
    case "context":
      return CauseCode.context;
    case "parent":
      return CauseCode.cascade;
    case "mount":
      return CauseCode.mount;
    default:
      return CauseCode.other;
  }
}
