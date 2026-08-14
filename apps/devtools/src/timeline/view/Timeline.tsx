import type { ComponentId } from "@reactlens/protocol";
import type { LaneControls } from "../../laneFilter.js";
import type { TimeCursor } from "../../timeCursor.js";
import type { Timeline as TimelineModel } from "../useTimeline.js";
import { Cascade } from "../../cascade/Cascade.js";

/**
 * @deprecated Compatibility adapter for callers that still mount the old
 * Timeline view entry point. Cascade is now the product/view abstraction.
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
    <Cascade
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
