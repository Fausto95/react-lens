import type {
  ComponentId,
  TimeTravelFailureReason,
  TimeTravelStoreFailureReason,
} from "@reactlens/protocol";

const REASON_LABEL: Record<TimeTravelFailureReason, string> = {
  "no-history": "history no longer retained",
  "no-fiber": "unmounted",
  "shape-mismatch": "hooks changed since capture",
  "write-failed": "renderer refused the write",
};

const STORE_REASON_LABEL: Record<TimeTravelStoreFailureReason, string> = {
  "no-snapshot": "no snapshot this far back",
  "snapshot-failed": "getSnapshot threw",
  "apply-failed": "applySnapshot threw",
};

export interface RestoreFailureItem {
  id: ComponentId;
  name: string;
  reason: TimeTravelFailureReason;
}

export interface RestoreStoreFailureItem {
  storeId: string;
  reason: TimeTravelStoreFailureReason;
}

/**
 * Set-wide restore feedback while traveling: "12 restored · 2 stores · 3
 * unavailable". Amber when anything failed; clicking jumps to the first failed
 * component (stores have none to select, so a store-only failure is inert).
 */
export function RestoreStatusPill({
  applied,
  failures,
  storesApplied = 0,
  storeFailures = [],
  onSelect,
}: {
  applied: number;
  failures: RestoreFailureItem[];
  storesApplied?: number;
  storeFailures?: RestoreStoreFailureItem[];
  onSelect?: (id: ComponentId) => void;
}) {
  const failedCount = failures.length + storeFailures.length;
  const partial = failedCount > 0;
  const lines = [
    ...failures.slice(0, 6).map((f) => `${f.name} — ${REASON_LABEL[f.reason]}`),
    ...storeFailures.slice(0, 6).map((f) => `${f.storeId} — ${STORE_REASON_LABEL[f.reason]}`),
  ];
  const hidden = failedCount - lines.length;
  const detail = partial
    ? lines.join("\n") + (hidden > 0 ? `\n… ${hidden} more` : "")
    : "Every component's state follows the playhead";
  const first = failures[0];
  return (
    <button
      type="button"
      className={`rl-tl-restore${partial ? " partial" : ""}`}
      title={detail}
      aria-label={
        partial
          ? `${applied} restored, ${failedCount} unavailable — select first affected component`
          : `${applied} components restored`
      }
      onClick={() => first && onSelect?.(first.id)}
      disabled={!first || !onSelect}
    >
      {applied} restored
      {storesApplied > 0 && (
        <span className="rl-tl-restore-stores">
          {" "}
          · {storesApplied} {storesApplied === 1 ? "store" : "stores"}
        </span>
      )}
      {partial && <span className="rl-tl-restore-fail"> · {failedCount} unavailable</span>}
    </button>
  );
}
