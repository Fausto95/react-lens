import type { LaneLayout } from "../model/rows.js";
import { packIntervals } from "../model/stacking.js";
import type { TimelineGeometryPayload } from "../timelineRendererClient.js";
import { CauseCode, RenderFlags, type TimelineQueryResult } from "@reactlens/trace-engine";

const CAUSE_TO_CODE: Record<string, number> = {
  props: CauseCode.props,
  state: CauseCode.state,
  context: CauseCode.context,
  cascade: CauseCode.cascade,
  mount: CauseCode.mount,
  other: CauseCode.other,
};

function repackStackRows(
  rowIndex: Uint32Array,
  x0: Float64Array,
  x1: Float64Array,
  stackRow: Uint16Array,
  count: number,
): void {
  const byRow = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const row = rowIndex[i]!;
    const indices = byRow.get(row);
    if (indices) indices.push(i);
    else byRow.set(row, [i]);
  }

  for (const indices of byRow.values()) {
    const packed = packIntervals(
      indices.map((i) => ({ key: i, start: x0[i]!, end: x1[i]! })),
    );
    for (const i of indices) stackRow[i] = packed.slots.get(i) ?? 0;
  }
}

/** Build transferable column geometry from a viewport layout (cap ~10k). */
export function geometryFromLayout(layout: LaneLayout, cap = 10_000): TimelineGeometryPayload {
  let estimate = 0;
  for (const row of layout.rows) estimate += row.clips.length;
  const stride = estimate > cap ? Math.ceil(estimate / cap) : 1;
  let count = 0;
  for (const row of layout.rows) count += Math.ceil(row.clips.length / stride);

  const rowIndex = new Uint32Array(count);
  const x0 = new Float64Array(count);
  const x1 = new Float64Array(count);
  const self = new Float32Array(count);
  const renderId = new Uint32Array(count);
  const componentId = new Uint32Array(count);
  const cause = new Uint8Array(count);
  const flags = new Uint8Array(count);
  const stackRow = new Uint16Array(count);
  const aggregate = new Uint8Array(count);
  const renderCount = new Uint32Array(count);
  const wastedCount = new Uint32Array(count);

  let k = 0;
  for (let ri = 0; ri < layout.rows.length; ri++) {
    const clips = layout.rows[ri]!.clips;
    for (let i = 0; i < clips.length; i += stride) {
      const c = clips[i]!;
      if (c.aggregate) continue;
      rowIndex[k] = ri;
      x0[k] = c.t0;
      x1[k] = c.t1;
      self[k] = c.self;
      renderId[k] = c.renderId as number;
      componentId[k] = c.componentId as number;
      cause[k] = CAUSE_TO_CODE[c.cause] ?? CauseCode.other;
      flags[k] = c.wasted ? RenderFlags.Wasted : RenderFlags.None;
      aggregate[k] = c.aggregate ? 1 : 0;
      renderCount[k] = c.renderCount ?? 1;
      wastedCount[k] = c.wastedCount ?? (c.wasted ? 1 : 0);
      k++;
    }
  }

  repackStackRows(rowIndex, x0, x1, stackRow, k);

  return {
    count: k,
    rowIndex,
    x0,
    x1,
    self,
    renderId,
    componentId,
    cause,
    flags,
    stackRow,
    aggregate,
    renderCount,
    wastedCount,
  };
}

/** Build transferable paint geometry directly from query typed arrays. */
export function geometryFromQueryResult(result: TimelineQueryResult): TimelineGeometryPayload {
  const count =
    result.lod === "raw" && result.columns
      ? result.columns.count
      : result.lod === "buckets" && result.buckets
        ? result.buckets.count
        : 0;
  const rowIndex = new Uint32Array(count);
  const x0 = new Float64Array(count);
  const x1 = new Float64Array(count);
  const self = new Float32Array(count);
  const renderId = new Uint32Array(count);
  const componentId = new Uint32Array(count);
  const cause = new Uint8Array(count);
  const flags = new Uint8Array(count);
  const stackRow = new Uint16Array(count);
  const aggregate = new Uint8Array(count);
  const renderCount = new Uint32Array(count);
  const wastedCount = new Uint32Array(count);

  if (result.lod === "raw" && result.columns) {
    const cols = result.columns;
    rowIndex.set(cols.rowIndex.subarray(0, count));
    x0.set(cols.x0.subarray(0, count));
    x1.set(cols.x1.subarray(0, count));
    self.set(cols.self.subarray(0, count));
    renderId.set(cols.renderId.subarray(0, count));
    componentId.set(cols.componentId.subarray(0, count));
    cause.set(cols.cause.subarray(0, count));
    flags.set(cols.flags.subarray(0, count));
    renderCount.fill(1);
    for (let i = 0; i < count; i++) {
      wastedCount[i] = (flags[i]! & RenderFlags.Wasted) !== 0 ? 1 : 0;
    }
    // Never trust the persisted stackRow for visual layout. Repartition the
    // viewport intervals so overlapping events cannot share a visual row.
    repackStackRows(rowIndex, x0, x1, stackRow, count);
  } else if (result.lod === "buckets" && result.buckets) {
    const buckets = result.buckets;
    rowIndex.set(buckets.rowIndex.subarray(0, count));
    x0.set(buckets.start.subarray(0, count));
    x1.set(buckets.end.subarray(0, count));
    self.set(buckets.selfTime.subarray(0, count));
    aggregate.fill(1);
    renderCount.set(buckets.renderCount.subarray(0, count));
    wastedCount.set(buckets.wastedCount.subarray(0, count));
    for (let i = 0; i < count; i++) {
      cause[i] = CauseCode.other;
      if (wastedCount[i]! > renderCount[i]! / 2) flags[i] = RenderFlags.Wasted;
    }
  }

  return {
    count,
    rowIndex,
    x0,
    x1,
    self,
    renderId,
    componentId,
    cause,
    flags,
    stackRow,
    aggregate,
    renderCount,
    wastedCount,
  };
}
