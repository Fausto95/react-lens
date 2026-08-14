/**
 * Tiered retention for long sessions:
 * HOT  — recent full detail in RAM
 * WARM — older columnar chunks in RAM (no snapshots)
 * COLD — compressed-ish columnar chunks in IndexedDB (async)
 * SUMMARY — LOD pyramids always in RAM (handled by TimelineIndex)
 *
 * Snapshots stay capped separately; event columns are the timeline source of truth.
 */

export type RetentionTier = "hot" | "warm" | "cold" | "summary";

export interface ColumnarChunk {
  /** Inclusive wall-time span. */
  t0: number;
  t1: number;
  count: number;
  timestamps: Float64Array;
  durations: Float32Array;
  selfDurations: Float32Array;
  renderIds: Uint32Array;
  componentIds: Uint32Array;
  commitIds: Uint32Array;
  causes: Uint8Array;
  flags: Uint8Array;
  laneKeys: string[];
  laneIndices: Int32Array;
}

export interface RetentionConfig {
  /** HOT window in ms (default 30s). */
  hotMs: number;
  /** Max WARM chunks retained in RAM. */
  maxWarmChunks: number;
  /** Target events per cold/warm chunk. */
  chunkEvents: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  hotMs: 30_000,
  maxWarmChunks: 32,
  chunkEvents: 50_000,
};

export interface ColdStore {
  put(chunk: ColumnarChunk): Promise<string>;
  get(id: string): Promise<ColumnarChunk | null>;
  delete(id: string): Promise<void>;
  list(): Promise<Array<{ id: string; t0: number; t1: number }>>;
}

/** In-memory cold store for tests / when IDB unavailable. */
export function createMemoryColdStore(): ColdStore {
  const map = new Map<string, ColumnarChunk>();
  let seq = 0;
  return {
    async put(chunk) {
      const id = `cold:${seq++}`;
      map.set(id, chunk);
      return id;
    },
    async get(id) {
      return map.get(id) ?? null;
    },
    async delete(id) {
      map.delete(id);
    },
    async list() {
      return [...map.entries()].map(([id, c]) => ({ id, t0: c.t0, t1: c.t1 }));
    },
  };
}

/**
 * Tracks HOT/WARM spill decisions. The live TimelineIndex remains HOT+WARM
 * merged for queries; callers optionally flush oldest warm → cold.
 */
export class RetentionManager {
  readonly config: RetentionConfig;
  warm: ColumnarChunk[] = [];
  coldIds: Array<{ id: string; t0: number; t1: number }> = [];
  private cold: ColdStore;

  constructor(cold: ColdStore, config: Partial<RetentionConfig> = {}) {
    this.cold = cold;
    this.config = { ...DEFAULT_RETENTION, ...config };
  }

  setColdStore(cold: ColdStore): void {
    this.cold = cold;
  }

  /**
   * Given the newest timestamp, decide if a slice of global columns should
   * leave HOT. Returns the cutoff time: events with t < cutoff are WARM candidates.
   */
  hotCutoff(newestT: number): number {
    return newestT - this.config.hotMs;
  }

  async spillWarmToCold(): Promise<number> {
    let spilled = 0;
    while (this.warm.length > this.config.maxWarmChunks) {
      const chunk = this.warm.shift()!;
      const id = await this.cold.put(chunk);
      this.coldIds.push({ id, t0: chunk.t0, t1: chunk.t1 });
      spilled++;
    }
    return spilled;
  }

  pushWarm(chunk: ColumnarChunk): void {
    this.warm.push(chunk);
  }

  async loadColdRange(t0: number, t1: number): Promise<ColumnarChunk[]> {
    const out: ColumnarChunk[] = [];
    for (const meta of this.coldIds) {
      if (meta.t1 < t0 || meta.t0 > t1) continue;
      const chunk = await this.cold.get(meta.id);
      if (chunk) out.push(chunk);
    }
    return out;
  }

  clear(): void {
    this.warm = [];
    this.coldIds = [];
  }
}

/** Slice a TimelineIndex-like columnar view into a transferable chunk. */
export function sliceToChunk(args: {
  t0: number;
  t1: number;
  count: number;
  timestamps: Float64Array;
  durations: Float32Array;
  selfDurations: Float32Array;
  renderIds: Uint32Array;
  componentIds: Uint32Array;
  commitIds: Uint32Array;
  causes: Uint8Array;
  flags: Uint8Array;
  laneIndices: Int32Array;
  laneOrder: string[];
}): ColumnarChunk | null {
  const { t0, t1, count } = args;
  let lo = 0;
  while (lo < count && args.timestamps[lo]! < t0) lo++;
  let hi = lo;
  while (hi < count && args.timestamps[hi]! <= t1) hi++;
  const n = hi - lo;
  if (n <= 0) return null;
  return {
    t0: args.timestamps[lo]!,
    t1: args.timestamps[hi - 1]! + args.durations[hi - 1]!,
    count: n,
    timestamps: args.timestamps.slice(lo, hi),
    durations: args.durations.slice(lo, hi),
    selfDurations: args.selfDurations.slice(lo, hi),
    renderIds: args.renderIds.slice(lo, hi),
    componentIds: args.componentIds.slice(lo, hi),
    commitIds: args.commitIds.slice(lo, hi),
    causes: args.causes.slice(lo, hi),
    flags: args.flags.slice(lo, hi),
    laneKeys: [...args.laneOrder],
    laneIndices: args.laneIndices.slice(lo, hi),
  };
}
