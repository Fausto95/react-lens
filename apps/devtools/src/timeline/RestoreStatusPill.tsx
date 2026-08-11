import type { ComponentId, TimeTravelFailureReason } from "@react-lens/protocol";

const REASON_LABEL: Record<TimeTravelFailureReason, string> = {
  "no-history": "history no longer retained",
  "no-fiber": "unmounted",
  "shape-mismatch": "hooks changed since capture",
  "write-failed": "renderer refused the write",
};

export interface RestoreFailureItem {
  id: ComponentId;
  name: string;
  reason: TimeTravelFailureReason;
}

/**
 * Set-wide restore feedback while traveling: "12 restored · 3 unavailable".
 * Amber when anything failed; clicking jumps to the first failed component.
 */
export function RestoreStatusPill({
  applied,
  failures,
  onSelect,
}: {
  applied: number;
  failures: RestoreFailureItem[];
  onSelect?: (id: ComponentId) => void;
}) {
  const partial = failures.length > 0;
  const detail = partial
    ? failures
        .slice(0, 6)
        .map((f) => `${f.name} — ${REASON_LABEL[f.reason]}`)
        .join("\n") + (failures.length > 6 ? `\n… ${failures.length - 6} more` : "")
    : "Every component's state follows the playhead";
  const first = failures[0];
  return (
    <button
      type="button"
      className={`rl-tl-restore${partial ? " partial" : ""}`}
      title={detail}
      aria-label={
        partial
          ? `${applied} restored, ${failures.length} unavailable — select first affected component`
          : `${applied} components restored`
      }
      onClick={() => first && onSelect?.(first.id)}
      disabled={!partial || !onSelect}
    >
      {applied} restored
      {partial && <span className="rl-tl-restore-fail"> · {failures.length} unavailable</span>}
    </button>
  );
}
