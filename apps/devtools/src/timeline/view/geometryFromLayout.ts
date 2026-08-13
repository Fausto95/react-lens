import type { LaneLayout } from "../model/rows.js";
import type { TimelineGeometryPayload } from "../timelineRendererClient.js";
import { CauseCode, RenderFlags } from "@reactlens/trace-engine";

const CAUSE_TO_CODE: Record<string, number> = {
  props: CauseCode.props,
  state: CauseCode.state,
  context: CauseCode.context,
  cascade: CauseCode.cascade,
  mount: CauseCode.mount,
  other: CauseCode.other,
};

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
      stackRow[k] = c.row;
      k++;
    }
  }

  return { count: k, rowIndex, x0, x1, self, renderId, componentId, cause, flags, stackRow };
}
