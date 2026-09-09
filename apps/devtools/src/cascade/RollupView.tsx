import { useState } from "react";
import type { ComponentId } from "@reactlens/protocol";
import { IconSparkle } from "@reactlens/icons";
import { FilterField } from "../FilterField.js";
import type { CascadeCause, CascadeNode, CascadeProjection } from "./model.js";
import {
  buildRollup,
  sortRollup,
  type RollupRow,
  type RollupSort,
  type RollupSortKey,
} from "./rollupModel.js";

/**
 * Cascade aggregated by component. This is the "what do I fix" view: how often
 * each component rendered, why, what it cost, and a verdict. Clicking a row
 * drills into its costliest instance in the other lenses.
 */

export interface RollupViewProps {
  projection: CascadeProjection | null;
  selectedName: string | null;
  /** Shared with the ledger, so a filter survives a lens switch. */
  query: string;
  onQuery: (query: string) => void;
  /** Components the Doctor flagged — the old Components-pane watchlist. */
  flagged?: ReadonlySet<ComponentId>;
  /** Hand a component to the AI panel. Omitted when the agent is unavailable. */
  onAddToAgent?: (id: ComponentId, name: string) => void;
  onSelect: (node: CascadeNode) => void;
  onHover: (node: CascadeNode | null) => void;
}

interface Column {
  key: RollupSortKey | null;
  label: string;
  align: "left" | "right";
  title?: string;
}

const COLUMNS: readonly Column[] = [
  { key: "name", label: "Component", align: "left" },
  { key: "renderCount", label: "Renders", align: "right" },
  { key: null, label: "Why", align: "left", title: "Cause mix across every render" },
  { key: "minDepth", label: "Depth", align: "left", title: "Causal depth it rendered at" },
  { key: "selfTime", label: "Self ms", align: "right" },
  { key: null, label: "Share", align: "right", title: "Share of this interaction's self time" },
  {
    key: null,
    label: "Compiled",
    align: "left",
    title: "Renders the React Compiler compiled",
  },
  { key: null, label: "Verdict", align: "left" },
];

function causeClass(cause: CascadeCause): string {
  switch (cause) {
    case "state":
    case "props":
    case "context":
      return cause;
    case "mount":
      return "mount";
    default:
      return "cascade";
  }
}

function depthLabel(row: RollupRow): string {
  return row.minDepth === row.maxDepth ? `d${row.minDepth}` : `d${row.minDepth}–d${row.maxDepth}`;
}

/**
 * How much of a component the React Compiler handled. `null` means the runtime
 * told us nothing, which is different from "not compiled" and must not read as
 * a failure.
 */
function compiledCell(row: RollupRow): { text: string; tone: "all" | "some" | "none" | "unknown" } {
  if (row.compilerKnownCount === 0) return { text: "—", tone: "unknown" };
  if (row.compiledCount === row.compilerKnownCount) return { text: "✓", tone: "all" };
  if (row.compiledCount === 0) return { text: "✗", tone: "none" };
  return { text: `${row.compiledCount}/${row.compilerKnownCount}`, tone: "some" };
}

export function RollupView({
  projection,
  selectedName,
  query,
  onQuery,
  flagged,
  onAddToAgent,
  onSelect,
  onHover,
}: RollupViewProps): React.ReactNode {
  const [sort, setSort] = useState<RollupSort>({ key: "selfTime", dir: "desc" });

  if (!projection || projection.nodes.length === 0) {
    return (
      <div className="rl-rollup">
        <div className="rl-cascade-empty">No render cascade is available for this interaction.</div>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const rows = sortRollup(buildRollup(projection, flagged), sort).filter(
    (row) => needle === "" || row.name.toLowerCase().includes(needle),
  );
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));

  const toggleSort = (key: RollupSortKey): void =>
    setSort((previous) =>
      previous.key === key
        ? { key, dir: previous.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );

  return (
    <div className="rl-rollup">
      <div className="rl-rollup-toolbar">
        <FilterField
          value={query}
          onChange={onQuery}
          onKeyDown={(event) => {
            if (event.key === "Escape") onQuery("");
          }}
        />
        <span className="rl-rollup-summary">
          {rows.length.toLocaleString()} {rows.length === 1 ? "component" : "components"} ·{" "}
          {projection.totalRenderCount.toLocaleString()} renders
        </span>
      </div>
      <div className="rl-rollup-scroller">
        <table className="rl-rollup-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => {
                const active = column.key !== null && sort.key === column.key;
                return (
                  <th
                    key={column.label}
                    title={column.title}
                    style={{ textAlign: column.align }}
                    aria-sort={
                      active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
                    }
                    data-sortable={column.key !== null || undefined}
                    onClick={() => column.key !== null && toggleSort(column.key)}
                  >
                    {column.label}
                    {column.key !== null ? (
                      <span className="rl-rollup-caret">
                        {active && sort.dir === "asc" ? "↑" : "↓"}
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const anchor = byId.get(row.anchorId);
              return (
                <tr
                  key={row.name}
                  data-selected={row.name === selectedName || undefined}
                  onMouseEnter={() => anchor && onHover(anchor)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => anchor && onSelect(anchor)}
                >
                  <td>
                    <span className="rl-rollup-name">
                      <span className={`rl-ledger-dot cause-${causeClass(row.dominantCause)}`} />
                      {row.name}
                      {row.flagged ? (
                        <span
                          className="rl-cascade-flag g-warn"
                          title="The Doctor found an issue with this component"
                          aria-label="has a Doctor issue"
                        >
                          ⚠
                        </span>
                      ) : null}
                      {onAddToAgent && anchor?.componentId != null ? (
                        <button
                          type="button"
                          className="rl-fix-ai rl-row-ai"
                          title={`Add ${row.name} to the AI panel`}
                          aria-label={`Add ${row.name} to the AI panel`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAddToAgent(anchor.componentId!, row.name);
                          }}
                        >
                          <IconSparkle size={11} />
                        </button>
                      ) : null}
                    </span>
                  </td>
                  <td className="rl-rollup-num">{row.renderCount.toLocaleString()}</td>
                  <td>
                    <span className="rl-rollup-mix">
                      {[...row.causes.entries()].map(([cause, count]) => (
                        <i
                          key={cause}
                          className={`cause-${causeClass(cause)}`}
                          style={{ flex: count }}
                          title={`${count}× ${cause}`}
                        />
                      ))}
                    </span>
                  </td>
                  <td className="rl-rollup-depth">{depthLabel(row)}</td>
                  <td className="rl-rollup-num">{row.selfTime.toFixed(2)}</td>
                  <td className="rl-rollup-num" data-hot={row.share > 0.2 || undefined}>
                    {(row.share * 100).toFixed(0)}%
                  </td>
                  <td>
                    <span
                      className="rl-rollup-compiled"
                      data-tone={compiledCell(row).tone}
                      title={
                        row.compilerKnownCount === 0
                          ? "The runtime reported no compiler status"
                          : `${row.compiledCount} of ${row.compilerKnownCount} renders compiled`
                      }
                    >
                      {compiledCell(row).text}
                    </span>
                  </td>
                  <td>
                    <span className="rl-rollup-verdict" data-tone={row.verdict.tone}>
                      {row.verdict.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
