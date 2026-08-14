import type { ComponentId } from "@reactlens/protocol";
import type { LaneControls } from "../../laneFilter.js";
import type { TimeCursor } from "../../timeCursor.js";
import type { Timeline as TimelineModel } from "../useTimeline.js";
import { CascadeTimeline } from "../cascade/CascadeTimeline.js";

/**
 * Cascade is the timeline presentation now. The trace/query model remains the
 * same `useTimeline` model so the existing columnar indexes, viewport stats,
 * tree heat and inspector selection contracts keep working unchanged.
 */
export function Timeline({
  model,
  cursor,
  onCursor,
  lanes: _lanes,
  fixApplied: _fixApplied,
  onSelectComponent,
  onHighlight,
  transport,
}: {
  model: TimelineModel;
  cursor: TimeCursor;
  onCursor: (cursor: TimeCursor) => void;
  lanes?: LaneControls;
  fixApplied?: boolean;
  onSelectComponent?: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  transport?: React.ReactNode;
}) {
  return (
    <CascadeTimeline
      store={model.store}
      model={model}
      cursor={cursor}
      onCursor={onCursor}
      {...(onSelectComponent ? { onSelectComponent } : {})}
      {...(onHighlight ? { onHighlight } : {})}
      {...(transport ? { transport } : {})}
    />
  );
}
