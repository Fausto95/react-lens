import type { SerializedValue } from "@react-lens/protocol";
import { diff } from "@react-lens/diff-engine";
import type { InspectorContext } from "../Inspector.js";
import { ValueRow, EmptyTab } from "./shared.js";

/**
 * Full props explorer with per-prop change status vs the previous render
 * (§75) — not just a diff dump. Function/reference-only changes are flagged
 * because they are the usual suspects behind avoidable renders.
 */
export function PropsTab({ ctx }: { ctx: InspectorContext }) {
  const { store, componentId, activeRenderId, snapshot } = ctx;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;

  const props = snapshot.props;
  if (props.k !== "object" || !props.entries || props.entries.length === 0) {
    return <EmptyTab>This component received no props.</EmptyTab>;
  }

  const statuses = changeStatuses(store, componentId, activeRenderId);

  return (
    <div className="rl-kv-list">
      {props.entries.map(([key, value]) => (
        <ValueRow key={key} name={key} value={value} status={statuses.get(key)} />
      ))}
    </div>
  );
}

function changeStatuses(
  store: InspectorContext["store"],
  componentId: InspectorContext["componentId"],
  activeRenderId: InspectorContext["activeRenderId"],
): Map<string, string> {
  const out = new Map<string, string>();
  if (activeRenderId === null) return out;
  const history = store.rendersOf(componentId);
  const idx = history.findIndex((r) => r.renderId === activeRenderId);
  if (idx <= 0) return out;
  const prev = store.snapshot(history[idx - 1]!.renderId);
  const cur = store.snapshot(activeRenderId);
  if (!prev || !cur) return out;

  const result = diff({ kind: "props", before: prev.props, after: cur.props });
  for (const change of result.changes) {
    if (change.path.length !== 1) continue;
    const key = String(change.path[0]);
    out.set(key, labelFor(change.kind, change.after));
  }
  return out;
}

function labelFor(kind: string, after?: SerializedValue): string {
  switch (kind) {
    case "FUNCTION_IDENTITY_CHANGED":
      return "fn";
    case "REFERENCE_ONLY_CHANGED":
      return "ref";
    case "VALUE_CHANGED":
      return "changed";
    case "ADDED":
      return "added";
    case "REMOVED":
      return "removed";
    default:
      return after ? "" : "";
  }
}
