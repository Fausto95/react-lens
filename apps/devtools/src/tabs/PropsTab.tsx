import { diff } from "@react-lens/diff-engine";
import type { InspectorContext } from "../Inspector.js";
import { ValueView, type EditFn } from "@react-lens/ui";
import { EmptyTab } from "./shared.js";

/**
 * Props explorer with per-prop change status vs the previous render and, when
 * editing is available, inline editors for primitive props that write back to
 * the running app via the renderer's overrideProps.
 */
export function PropsTab({ ctx }: { ctx: InspectorContext }) {
  const { store, componentId, activeRenderId, snapshot, edit } = ctx;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;

  const props = snapshot.props;
  if (props.k !== "object" || !props.entries || props.entries.length === 0) {
    return <EmptyTab>This component received no props.</EmptyTab>;
  }

  const statuses = changeStatuses(store, componentId, activeRenderId);
  const editFn: EditFn | undefined = edit
    ? (path, value) => edit.setProp(componentId, path, value)
    : undefined;

  return (
    <div className="rl-val-list">
      {props.entries.map(([key, value]) => {
        const status = statuses.get(key);
        const tint =
          status === "changed" || status === "added" || status === "removed"
            ? " changed"
            : status === "fn" || status === "ref"
              ? " identity"
              : "";
        return (
          <div className={`rl-val-row${tint}`} key={key}>
            <span className="rl-val-key">{key}</span>
            <ValueView value={value} path={[key]} edit={editFn} />
            {status && <span className={`rl-badge ${statusClass(status)}`}>{status}</span>}
          </div>
        );
      })}
    </div>
  );
}

function statusClass(status: string): string {
  if (status === "fn" || status === "ref") return "suspicious";
  if (status === "changed") return "warn";
  return "dim";
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
    out.set(String(change.path[0]), labelFor(change.kind));
  }
  return out;
}

function labelFor(kind: string): string {
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
      return "";
  }
}
