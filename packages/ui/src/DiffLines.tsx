import type { DiffResult } from "@reactlens/diff-engine";
import { formatValue } from "./format.js";

/** Renders the changed entries of a DiffResult as before → after lines. */
export function DiffLines({ result }: { result: DiffResult }) {
  const changes = result.changes.filter((c) => c.kind !== "UNCHANGED" && c.path.length > 0);
  if (changes.length === 0) return <div className="rl-diff rl-muted">No value changes.</div>;
  return (
    <div className="rl-diff">
      {changes.map((c, i) => (
        <div className={`rl-diff-line rl-chg-${c.kind}`} key={i}>
          <span className="rl-path">{c.path.join(".") || "(root)"}</span>
          <span>
            {formatValue(c.before)} → {formatValue(c.after)}
          </span>
        </div>
      ))}
    </div>
  );
}
